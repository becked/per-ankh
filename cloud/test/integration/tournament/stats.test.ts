// Integration tests for the two tournament stats endpoints:
//   GET /v1/tournaments/:id/stats        — Plane A competition (standings + casters)
//   GET /v1/tournaments/:id/stats/games  — Plane B1 ChartBundleCore over the games
//
// Covers the setup gate, the view rate-limit, response shapes, the corpus
// filters (status='complete' + non-null game_id), the focal widening (each human
// counted once), and the KV cache write/read + key-drift invalidation.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";
import { TOURNAMENT_VIEW_PER_HOUR } from "../../../src/tournament/limits";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// Seed a game with two human player_summaries and link it to a match. Mirrors
// what the upload flow persists (a roster row per player + the slot↔index
// bridge) but via direct SQL, independent of the upload fixture. player_index 0
// is the uploader; both are human, so the "humans" widening counts both.
async function linkGame(opts: {
	matchId: string;
	status: "complete" | "forfeit";
	ownerId: string;
	nations: [string, string]; // [slot_a nation, slot_b nation]
	// Occupant snapshot usernames (0024) — the participant key for player_picks.
	// Defaults are distinct per game so unrelated links don't merge into one row.
	usernames?: [string, string];
}): Promise<string> {
	const gameId = nanoid(21);
	await env.SHARE_DB.prepare(
		`INSERT INTO games (game_id, user_id, xml_game_id, total_turns,
		                    file_hash, is_public, parser_version)
		 VALUES (?, ?, 'xml', 60, ?, 1, '2.9.1')`,
	)
		.bind(gameId, opts.ownerId, nanoid(16))
		.run();
	for (const idx of [0, 1] as const) {
		await env.SHARE_DB.prepare(
			`INSERT INTO player_summaries
			   (game_id, player_index, player_name, nation, is_human, is_uploader,
			    is_winner, final_points)
			 VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
		)
			.bind(
				gameId,
				idx,
				`Player ${idx}`,
				opts.nations[idx],
				idx === 0 ? 1 : 0, // uploader = slot_a
				idx === 0 ? 1 : 0, // slot_a won
				100 + idx * 10,
			)
			.run();
	}
	const [ua, ub] = opts.usernames ?? [
		`A-${gameId.slice(0, 6)}`,
		`B-${gameId.slice(0, 6)}`,
	];
	await env.SHARE_DB.prepare(
		`UPDATE tournament_matches
		 SET status = ?, game_id = ?, winner_slot_id = slot_a_id,
		     slot_a_player_index = 0, slot_b_player_index = 1,
		     slot_a_username = ?, slot_b_username = ?,
		     reported_by_user_id = ?, reported_at = datetime('now')
		 WHERE match_id = ?`,
	)
		.bind(opts.status, gameId, ua, ub, opts.ownerId, opts.matchId)
		.run();
	return gameId;
}

describe("GET /v1/tournaments/:id/stats (Plane A)", () => {
	it("returns the standings block and the caster leaderboard", async () => {
		const caster = await makeUser({ displayName: "Caster McCastface" });
		const t = await makeTournament({ advanceTo: "swiss-round-1-complete" });

		// Attach a caster to one match's parts (migration 0029 JSON).
		const someMatch = (await t.matches())[0];
		await env.SHARE_DB.prepare(
			`UPDATE tournament_matches SET parts = ?, parts_rev = parts_rev + 1
			 WHERE match_id = ?`,
		)
			.bind(
				JSON.stringify([
					{
						id: "pt1",
						scheduled_at: null,
						casters: [{ user_id: caster.userId, name: caster.discordUsername }],
						streams: [],
					},
				]),
				someMatch.match_id,
			)
			.run();

		const body = await expectOk<{
			standings: {
				tournament_id: string;
				divisions: { A: { standings: unknown[] }; B: { standings: unknown[] } };
				combined_qualifier_ranking?: unknown[];
			};
			caster_leaderboard: Array<{
				user_id: string | null;
				name: string | null;
				display_name: string | null;
				avatar_url: string | null;
				appearances: number;
			}>;
		}>(
			await request.get({
				path: `/v1/tournaments/${t.tournamentId}/stats`,
				as: t.admin,
			}),
		);

		// Standings embedded (reused from computeStandingsResponse).
		expect(body.standings.tournament_id).toBe(t.tournamentId);
		expect(body.standings.divisions.A.standings.length).toBe(4);
		expect(body.standings.combined_qualifier_ranking).toBeDefined();

		// Caster leaderboard: the one caster, identity enriched from users.
		expect(body.caster_leaderboard.length).toBe(1);
		const row = body.caster_leaderboard[0];
		expect(row.user_id).toBe(caster.userId);
		expect(row.display_name).toBe("Caster McCastface");
		expect(row.appearances).toBe(1);
	});

	it("attributes per-player nation picks from completed games", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const matches = await t.matches();
		await linkGame({
			matchId: matches[0].match_id,
			status: "complete",
			ownerId: t.admin.userId,
			nations: ["NATION_ROME", "NATION_PERSIA"], // slot_a (winner) / slot_b
			usernames: ["Alice", "Bob"],
		});

		const body = await expectOk<{
			player_picks: Array<{
				user_id: string | null;
				name: string | null;
				display_name: string | null;
				picks: Array<{ nation: string; games: number; wins: number }>;
				total_games: number;
				total_wins: number;
			}>;
		}>(
			await request.get({
				path: `/v1/tournaments/${t.tournamentId}/stats`,
				as: t.admin,
			}),
		);

		const alice = body.player_picks.find(
			(p) => (p.display_name ?? p.name) === "Alice",
		);
		const bob = body.player_picks.find(
			(p) => (p.display_name ?? p.name) === "Bob",
		);
		// slot_a won (winner_slot_id = slot_a_id, player_index 0 is_winner=1).
		expect(alice?.picks).toEqual([{ nation: "NATION_ROME", games: 1, wins: 1 }]);
		expect(alice?.total_wins).toBe(1);
		expect(bob?.picks).toEqual([{ nation: "NATION_PERSIA", games: 1, wins: 0 }]);
		expect(bob?.total_wins).toBe(0);
	});

	it("404s during setup for a non-admin, but serves the admin", async () => {
		const t = await makeTournament(); // setup, signups closed
		const viewer = await makeUser();

		await expectErrorCode(
			await request.get({
				path: `/v1/tournaments/${t.tournamentId}/stats`,
				as: viewer,
			}),
			{ status: 404, code: "TOURNAMENT_NOT_FOUND" },
		);
		await expectOk(
			await request.get({
				path: `/v1/tournaments/${t.tournamentId}/stats`,
				as: t.admin,
			}),
		);
	});

	it("enforces the tournament-view rate limit", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const ip = "203.0.113.60";
		for (let i = 0; i < TOURNAMENT_VIEW_PER_HOUR; i++) {
			await env.SHARE_DB.prepare(
				`INSERT INTO events (event_type, ip_address) VALUES ('tournament_view', ?)`,
			)
				.bind(ip)
				.run();
		}
		const res = await SELF.fetch(
			`http://test/v1/tournaments/${t.tournamentId}/stats`,
			{ headers: { "CF-Connecting-IP": ip, "CF-RAY": "test-ray" } },
		);
		await expectErrorCode(res, {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_VIEW",
		});
	});
});

describe("GET /v1/tournaments/:id/stats/games (Plane B1)", () => {
	it("aggregates completed-match saves, counting each human once", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const matches = await t.matches();

		// One complete match with a linked 2-human game (Rome beats Persia)…
		await linkGame({
			matchId: matches[0].match_id,
			status: "complete",
			ownerId: t.admin.userId,
			nations: ["NATION_ROME", "NATION_PERSIA"],
		});
		// …and one FORFEIT match holding a linked game — excluded by the
		// status='complete' filter, so its nation must not appear.
		await linkGame({
			matchId: matches[1].match_id,
			status: "forfeit",
			ownerId: t.admin.userId,
			nations: ["NATION_EGYPT", "NATION_KUSH"],
		});

		const body = await expectOk<{
			meta: { game_count: number };
			summary: { total_games: number; top_nation?: unknown };
			nationWinRate: Array<{ nation: string; games: number; wins: number }>;
			win_rate?: unknown;
			games_with_outcome?: unknown;
		}>(
			await request.get({
				path: `/v1/tournaments/${t.tournamentId}/stats/games`,
				as: t.admin,
			}),
		);

		// Only the one complete-match game is in the corpus.
		expect(body.meta.game_count).toBe(1);

		// Widening: both humans of the 1v1 counted, each nation with games=1.
		const byNation = new Map(body.nationWinRate.map((r) => [r.nation, r]));
		expect(byNation.get("NATION_ROME")).toMatchObject({ games: 1, wins: 1 });
		expect(byNation.get("NATION_PERSIA")).toMatchObject({ games: 1, wins: 0 });
		// Forfeit-match game excluded.
		expect(byNation.has("NATION_EGYPT")).toBe(false);
		expect(byNation.has("NATION_KUSH")).toBe(false);

		// Core-only shape: the broken-by-widening Overview fields are absent.
		expect(body.win_rate).toBeUndefined();
		expect(body.games_with_outcome).toBeUndefined();
		expect(body.summary.top_nation).toBeUndefined();
	});

	it("caches the bundle and serves it until the key drifts", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const matches = await t.matches();
		await linkGame({
			matchId: matches[0].match_id,
			status: "complete",
			ownerId: t.admin.userId,
			nations: ["NATION_ROME", "NATION_PERSIA"],
		});

		const get = async () =>
			expectOk<{ meta: { game_count: number } }>(
				await request.get({
					path: `/v1/tournaments/${t.tournamentId}/stats/games`,
					as: t.admin,
				}),
			);

		// First read computes over the linked game and writes the cache.
		expect((await get()).meta.game_count).toBe(1);
		const listed = await env.SESSIONS_KV.list({ prefix: "stats:" });
		expect(
			listed.keys.some((k) =>
				k.name.includes(`:tournament:${t.tournamentId}:`),
			),
		).toBe(true);

		// Remove the game link WITHOUT bumping updated_at → the key is unchanged,
		// so the second read is served stale from cache (proves the read path).
		await env.SHARE_DB.prepare(
			`UPDATE tournament_matches SET game_id = NULL WHERE match_id = ?`,
		)
			.bind(matches[0].match_id)
			.run();
		expect((await get()).meta.game_count).toBe(1);

		// Bump updated_at → the key drifts → the next read recomputes (game gone).
		await env.SHARE_DB.prepare(
			`UPDATE tournaments SET updated_at = '2099-01-01 00:00:00'
			 WHERE tournament_id = ?`,
		)
			.bind(t.tournamentId)
			.run();
		expect((await get()).meta.game_count).toBe(0);
	});

	it("404s during setup for a non-admin", async () => {
		const t = await makeTournament();
		const viewer = await makeUser();
		await expectErrorCode(
			await request.get({
				path: `/v1/tournaments/${t.tournamentId}/stats/games`,
				as: viewer,
			}),
			{ status: 404, code: "TOURNAMENT_NOT_FOUND" },
		);
	});

	it("enforces the tournament-view rate limit", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const ip = "203.0.113.61";
		for (let i = 0; i < TOURNAMENT_VIEW_PER_HOUR; i++) {
			await env.SHARE_DB.prepare(
				`INSERT INTO events (event_type, ip_address) VALUES ('tournament_view', ?)`,
			)
				.bind(ip)
				.run();
		}
		const res = await SELF.fetch(
			`http://test/v1/tournaments/${t.tournamentId}/stats/games`,
			{ headers: { "CF-Connecting-IP": ip, "CF-RAY": "test-ray" } },
		);
		await expectErrorCode(res, {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_VIEW",
		});
	});
});
