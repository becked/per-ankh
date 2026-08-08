// GET /v1/stats/players — the public played-games leaderboard.
//
// The endpoint's whole point is attribution beyond the uploader: one upload
// credits every human seat that maps to a registered user (uploader via the
// is_uploader seat, everyone else via player_summaries.online_id matched
// against user_online_ids), with double-uploaded matches deduped on
// xml_game_id. These tests pin that attribution, the category split, the
// since/until window (until exclusive; closed windows cache for a day), the
// anon_read gate, and the PII stance: linking online ids must never appear
// in the response.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { ANON_READS_PER_HOUR } from "../../../src/games";
import { expectErrorCode } from "../../helpers/assertions";
import { makeUser, type TestUser } from "../../helpers/builders";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

interface Seat {
	online_id?: string;
	is_human?: boolean;
	is_uploader?: boolean;
}

// Direct INSERT, same rationale as helpers/games.ts seedGame: the endpoint
// reads only D1, and driving the real upload path would need a parsed save.
async function seedPlayedGame(opts: {
	uploader: TestUser;
	xmlGameId?: string;
	gameMode?: string | null;
	createdAt?: string; // ISO date; defaults to now
	seats: Seat[];
}): Promise<string> {
	const gameId = nanoid(21);
	await env.SHARE_DB.prepare(
		`INSERT INTO games (
			game_id, user_id, xml_game_id, total_turns, file_hash,
			game_name, is_public, blob_version, blob_size_bytes, parser_version,
			game_mode, created_at
		) VALUES (?, ?, ?, 50, ?, 'Leaderboard Game', 1, 2, 1024, '1.0.0', ?,
		          COALESCE(?, datetime('now')))`,
	)
		.bind(
			gameId,
			opts.uploader.userId,
			opts.xmlGameId ?? nanoid(36),
			nanoid(64),
			opts.gameMode ?? null,
			opts.createdAt ?? null,
		)
		.run();
	for (const [i, seat] of opts.seats.entries()) {
		await env.SHARE_DB.prepare(
			`INSERT INTO player_summaries (
				game_id, player_index, player_name, is_human, is_uploader, online_id
			) VALUES (?, ?, ?, ?, ?, ?)`,
		)
			.bind(
				gameId,
				i,
				`Player ${i}`,
				(seat.is_human ?? true) ? 1 : 0,
				(seat.is_uploader ?? false) ? 1 : 0,
				seat.online_id ?? null,
			)
			.run();
	}
	return gameId;
}

async function linkOnlineId(user: TestUser, onlineId: string): Promise<void> {
	await env.SHARE_DB.prepare(
		`INSERT INTO user_online_ids (user_id, online_id) VALUES (?, ?)`,
	)
		.bind(user.userId, onlineId)
		.run();
}

// Per-IP requests, same shape as anon-read-rate-limit.test.ts: requests.ts
// omits CF-Connecting-IP unless CF-RAY is present, so per-IP tests build
// headers themselves.
function get(
	query: string,
	opts?: { ip?: string; ua?: string },
): Promise<Response> {
	const headers: Record<string, string> = {
		Origin: "http://localhost:1420",
		"CF-Connecting-IP": opts?.ip ?? `10.9.${nanoid(4)}`,
		"CF-RAY": "test-ray",
	};
	if (opts?.ua) headers["User-Agent"] = opts.ua;
	return SELF.fetch(`http://test/v1/stats/players${query}`, { headers });
}

interface LeaderboardBody {
	players: {
		user_id: string;
		display_name: string;
		duels_network: number;
		duels_cloud: number;
		ffas: number;
		total: number;
	}[];
}

function rowFor(body: LeaderboardBody, user: TestUser) {
	return body.players.find((p) => p.user_id === user.userId);
}

describe("GET /v1/stats/players", () => {
	it("credits the uploader's seat and online_id-matched seats, once per match", async () => {
		const uploader = await makeUser();
		const opponent = await makeUser();
		const onlineId = `STEAM_${nanoid(12)}`;
		await linkOnlineId(opponent, onlineId);

		const xmlGameId = nanoid(36);
		// Both players upload the same network duel — separate games rows,
		// same save GameId.
		for (const user of [uploader, opponent]) {
			await seedPlayedGame({
				uploader: user,
				xmlGameId,
				gameMode: "NETWORK",
				seats: [
					{ is_uploader: user === uploader },
					{ online_id: onlineId, is_uploader: user === opponent },
				],
			});
		}

		const res = await get("");
		expect(res.status).toBe(200);
		const body = (await res.json()) as LeaderboardBody;
		for (const user of [uploader, opponent]) {
			const row = rowFor(body, user);
			expect(row).toBeDefined();
			expect(row!.duels_network).toBe(1);
			expect(row!.total).toBe(1);
		}
		// The uploader has no linked online id and the opponent's is linking
		// data only — neither may surface anywhere in the response.
		expect(JSON.stringify(body)).not.toContain(onlineId);
	});

	it("splits duels by game mode and counts 3+ humans as FFAs", async () => {
		const user = await makeUser();
		await seedPlayedGame({
			uploader: user,
			gameMode: "PLAY_BY_CLOUD",
			seats: [{ is_uploader: true }, {}],
		});
		await seedPlayedGame({
			uploader: user,
			gameMode: "NETWORK",
			seats: [{ is_uploader: true }, {}, {}],
		});
		// Single-player: one human seat, AI opponents — total only.
		await seedPlayedGame({
			uploader: user,
			gameMode: null,
			seats: [{ is_uploader: true }, { is_human: false }],
		});

		const body = (await (await get("")).json()) as LeaderboardBody;
		const row = rowFor(body, user)!;
		expect(row.duels_cloud).toBe(1);
		expect(row.ffas).toBe(1);
		expect(row.duels_network).toBe(0);
		expect(row.total).toBe(3);
	});

	it("ignores unregistered online ids and AI seats", async () => {
		const uploader = await makeUser();
		await seedPlayedGame({
			uploader,
			gameMode: "NETWORK",
			seats: [
				{ is_uploader: true },
				{ online_id: `STEAM_${nanoid(12)}` }, // human, but not linked
				{ is_human: false, online_id: `STEAM_${nanoid(12)}` },
			],
		});

		const body = (await (await get("")).json()) as LeaderboardBody;
		expect(rowFor(body, uploader)!.total).toBe(1);
	});

	it("windows on created_at with until exclusive, and 400s malformed dates", async () => {
		const user = await makeUser();
		await seedPlayedGame({
			uploader: user,
			gameMode: "NETWORK",
			createdAt: "2020-06-15 12:00:00",
			seats: [{ is_uploader: true }, {}],
		});
		await seedPlayedGame({
			uploader: user,
			gameMode: "NETWORK",
			createdAt: "2020-09-01 00:00:00", // on the until boundary — excluded
			seats: [{ is_uploader: true }, {}],
		});

		const windowed = (await (
			await get("?since=2020-06-01&until=2020-09-01")
		).json()) as LeaderboardBody;
		expect(rowFor(windowed, user)!.total).toBe(1);

		const bad = await get("?since=June-2020");
		await expectErrorCode(bad, { status: 400, code: "INVALID_QUERY" });
	});

	it("caches a closed window for a day and an open one briefly", async () => {
		const closed = await get("?since=2020-06-01&until=2020-09-01");
		expect(closed.headers.get("Cache-Control")).toBe(
			"public, max-age=86400, s-maxage=86400",
		);
		const open = await get("");
		expect(open.headers.get("Cache-Control")).toBe(
			"public, max-age=300, s-maxage=60",
		);
	});

	it("429s an anonymous read once the per-IP anon_read cap is reached", async () => {
		const ip = `10.8.${nanoid(6)}`;
		// Same single-statement bucket fill as anon-read-rate-limit.test.ts.
		await env.SHARE_DB.prepare(
			`INSERT INTO events (event_type, ip_address)
			 WITH RECURSIVE seq(i) AS (
			   SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < ?
			 )
			 SELECT 'anon_read', ? FROM seq`,
		)
			.bind(ANON_READS_PER_HOUR, ip)
			.run();

		const limited = await get("", { ip });
		await expectErrorCode(limited, { status: 429, code: "RATE_LIMIT" });

		// Scraper UAs stay exempt.
		const scraper = await get("", { ip, ua: "Discordbot/2.0" });
		expect(scraper.status).toBe(200);
	});
});
