// GET /v1/games/:id/card.png — the per-game link-preview image.
//
// This is the only place the rasterizer runs: resvg is imported as a `.wasm`
// module, which nothing but workerd (and the Miniflare isolate here) can
// resolve, so the unit tests next to the builder stop at the SVG string. What
// this file is for is everything that only shows up once all of it is wired
// together — that the wasm module compiles and renders, that the fonts the
// bake produced actually load, that the PNG comes out at the size the meta
// tags promise, and that the visibility rule, the cache posture and the
// canonical-URL rule hold.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { expectErrorCode } from "../../helpers/assertions";
import { makeUser, type TestUser } from "../../helpers/builders";
import { seedGame, seedSeats } from "../../helpers/games";
import { request } from "../../helpers/requests";
import { CARD_HEIGHT, CARD_WIDTH } from "../../../../src/lib/og-card";

let owner: TestUser;

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	owner = await makeUser({ discordUsername: "og-card-owner" });
});

// Per-turn points for a seat, so the card has a VP sparkline to draw.
async function seedPoints(
	gameId: string,
	playerIndex: number,
	turns: number,
): Promise<void> {
	await env.SHARE_DB.prepare(
		`INSERT INTO game_player_turn (game_id, player_index, turn, points)
		 WITH RECURSIVE seq(i) AS (
		   SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < ?
		 )
		 SELECT ?, ?, i, i * 2 FROM seq`,
	)
		.bind(turns, gameId, playerIndex)
		.run();
}

// The PNG signature, then the IHDR width/height — the only two numbers that
// have to match what buildMeta declares as og:image:width / :height.
function pngSize(bytes: Uint8Array): { width: number; height: number } {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	expect([...bytes.slice(0, 8)]).toEqual(signature);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function updatedAt(gameId: string): Promise<string> {
	const row = await env.SHARE_DB.prepare(
		`SELECT updated_at FROM games WHERE game_id = ?`,
	)
		.bind(gameId)
		.first<{ updated_at: string }>();
	if (!row) throw new Error(`no game ${gameId}`);
	return row.updated_at;
}

// Ask the Worker which URL it considers canonical, rather than rebuilding it
// here: `v` and `c` both come from code this test is checking, so a copy of
// the formula would only ever agree with itself. Any non-canonical request
// redirects, so the bare path is the cheapest way to be told.
async function canonicalPath(gameId: string): Promise<string> {
	const res = await SELF.fetch(`http://test/v1/games/${gameId}/card.png`, {
		redirect: "manual",
	});
	expect(res.status).toBe(302);
	const location = res.headers.get("Location");
	expect(location).toBeTruthy();
	const url = new URL(location!);
	expect(url.searchParams.get("v")).toBe(await updatedAt(gameId));
	// The renderer version. Present and non-empty is the whole assertion — its
	// value is OG_CARD_VERSION (src/lib/og-card.ts), which the Worker and the
	// page's og:image URL both read from that one module, so they cannot
	// disagree about it.
	expect(url.searchParams.get("c")).toMatch(/^\d+$/);
	return `${url.pathname}${url.search}`;
}

async function seedPublicGameWithChart(): Promise<string> {
	const gameId = await seedGame(owner, {
		isPublic: true,
		gameName: "Card Fixture",
	});
	await seedSeats(gameId, [
		{ index: 0, nation: "NATION_ROME", uploader: true },
		{ index: 1, nation: "NATION_EGYPT", uploader: false },
	]);
	await seedPoints(gameId, 0, 20);
	await seedPoints(gameId, 1, 20);
	return gameId;
}

describe("GET /v1/games/:id/card.png", () => {
	it("renders the PNG at the size the meta tags declare", async () => {
		// Against CARD_WIDTH / CARD_HEIGHT, not against 1200×630 written out
		// here: those two constants are what the game page hands the crawler as
		// og:image:width / og:image:height (src/lib/og-card.ts), so literals
		// would let the rendered size and the declared size move apart without
		// failing anything.
		const gameId = await seedPublicGameWithChart();
		const res = await request.get({ path: await canonicalPath(gameId) });
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/png");
		const bytes = new Uint8Array(await res.arrayBuffer());
		expect(pngSize(bytes)).toEqual({
			width: CARD_WIDTH,
			height: CARD_HEIGHT,
		});
	});

	it("keeps its shared-cache directive through the wrapper", async () => {
		// The `sharedCache` flag in ROUTES is what makes this reachable; without
		// it the wrapper in index.ts rewrites the response `private, no-store`
		// and every unfurl re-renders the card.
		//
		// The exact string, because the edge half of it is load-bearing: it is
		// the only thing bounding how long a card for a game since made private
		// or deleted carries on being served (nothing purges it). Lengthening it
		// lengthens that window, so it is not a number to retune in passing.
		const gameId = await seedPublicGameWithChart();
		const res = await request.get({ path: await canonicalPath(gameId) });
		expect(res.headers.get("Cache-Control")).toBe(
			"public, max-age=31536000, s-maxage=86400",
		);
		// A stored entry outlives the request that filled it, so the id would
		// be replayed to everyone for the whole s-maxage.
		expect(res.headers.get("X-Request-Id")).toBeNull();
	});

	it("renders a game with no series at all", async () => {
		// No player_summaries and no game_player_turn: the card centres its
		// rows instead of coming out a different size, which is what lets
		// buildMeta declare one pair of dimensions for every game.
		const gameId = await seedGame(owner, { isPublic: true });
		const res = await request.get({ path: await canonicalPath(gameId) });
		expect(res.status).toBe(200);
		const bytes = new Uint8Array(await res.arrayBuffer());
		expect(pngSize(bytes)).toEqual({
			width: CARD_WIDTH,
			height: CARD_HEIGHT,
		});
	});

	it("redirects a superseded version pair instead of rendering it", async () => {
		// The URL in an embed posted before the game was last written. It has
		// to keep answering — Discord re-fetches an embed's image without
		// re-reading the page's meta tags — and it must not re-render, because
		// every distinct pair is its own cache key.
		const gameId = await seedPublicGameWithChart();
		const res = await SELF.fetch(
			`http://test/v1/games/${gameId}/card.png?v=2026-01-01+00%3A00%3A00&c=1`,
			{ redirect: "manual" },
		);
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(
			`http://test${await canonicalPath(gameId)}`,
		);
		// Storable, so a link doing the rounds costs one D1 read an hour, and
		// short, so a game written in the meantime is picked up by the next
		// crawl rather than at the end of the card's own year.
		expect(res.headers.get("Cache-Control")).toBe(
			"public, max-age=3600, s-maxage=3600",
		);
	});

	it("redirects a right `v` with the renderer version missing", async () => {
		// `c` is the half `updated_at` cannot cover: a deploy that changed
		// card-svg.ts moves no game row and purges no edge entry.
		const gameId = await seedPublicGameWithChart();
		const v = encodeURIComponent(await updatedAt(gameId));
		const res = await SELF.fetch(
			`http://test/v1/games/${gameId}/card.png?v=${v}`,
			{ redirect: "manual" },
		);
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(
			`http://test${await canonicalPath(gameId)}`,
		);
	});

	it("gives a spoofed crawler a redirect, not a render, off a made-up `v`", async () => {
		// The read budget exempts scraper UAs by a prefix test on a header
		// anyone can send (read-budget.ts), so the canonical-pair check is the
		// only thing standing between that exemption and unmetered renders on
		// an endless supply of fresh cache keys.
		const gameId = await seedPublicGameWithChart();
		const res = await SELF.fetch(
			`http://test/v1/games/${gameId}/card.png?v=${nanoid(21)}&c=99999`,
			{
				redirect: "manual",
				headers: { "User-Agent": "Discordbot/2.0 (+https://discordapp.com)" },
			},
		);
		expect(res.status).toBe(302);
		expect(res.headers.get("Content-Type")).not.toBe("image/png");
	});

	it("redirects a canonical pair carrying an extra parameter", async () => {
		// The query string is the edge cache key, so `?v=…&c=1&x=1` and
		// `?v=…&c=1&x=2` are two entries and two renders even though both carry
		// the canonical pair. Reading `v` and `c` out of the string would pass
		// them both; comparing the whole string is what bounds the renders to
		// one per game.
		const gameId = await seedPublicGameWithChart();
		const canonical = await canonicalPath(gameId);
		const res = await SELF.fetch(`http://test${canonical}&x=1`, {
			redirect: "manual",
			headers: { "User-Agent": "Discordbot/2.0 (+https://discordapp.com)" },
		});
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(`http://test${canonical}`);
	});

	it("404s a private game, for its owner as much as anyone", async () => {
		const gameId = await seedGame(owner, { isPublic: false });
		await expectErrorCode(
			await request.get({ path: `/v1/games/${gameId}/card.png` }),
			{ status: 404, code: "NOT_FOUND" },
		);
		// The owner is no exception: this URL is only ever fetched by whoever
		// holds the link, and a session on it would be a cache variant.
		await expectErrorCode(
			await request.get({ path: `/v1/games/${gameId}/card.png`, as: owner }),
			{ status: 404, code: "NOT_FOUND" },
		);
	});

	it("404s an unknown game the same way", async () => {
		await expectErrorCode(
			await request.get({ path: `/v1/games/${nanoid(21)}/card.png` }),
			{ status: 404, code: "NOT_FOUND" },
		);
	});

	it("charges the og_card_view budget, and exempts a link-preview crawler", async () => {
		const gameId = await seedPublicGameWithChart();
		const path = await canonicalPath(gameId);
		const before = await countCardViews();

		await SELF.fetch(`http://test${path}`, {
			headers: { "User-Agent": "Discordbot/2.0 (+https://discordapp.com)" },
		});
		expect(await countCardViews()).toBe(before);

		await request.get({ path });
		expect(await countCardViews()).toBe(before + 1);
	});
});

async function countCardViews(): Promise<number> {
	const row = await env.SHARE_DB.prepare(
		`SELECT COUNT(*) AS n FROM events WHERE event_type = 'og_card_view'`,
	).first<{ n: number }>();
	return row?.n ?? 0;
}
