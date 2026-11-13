// The ad-hoc query endpoint, against real D1.
//
// The unit tests beside the compiler prove what SQL it emits; this proves the
// SQL runs and answers, which is the half a string assertion cannot reach.
//
// The corpus is one match uploaded by both of its players — the shape issue
// #272 names as the thing a count gets wrong. Two rows in `games`, two rows in
// `wonder_events`, four rows in `player_summaries`, one match. Everything here
// turns on the difference between those numbers.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { makeUser, type TestUser } from "../../helpers/builders";
import { postMultipart, request } from "../../helpers/requests";
import { buildUploadFormData } from "../../helpers/save-blob";

// Seat 0 is Egypt and seat 1 Rome (test/helpers/save-blob.ts). The issue's own
// question names Carthage; the nation is a bound value either way, and the
// fixture's roster is what decides which one is on the board.
const EGYPT = "NATION_EGYPT";
const PYRAMIDS = "IMPROVEMENT_PYRAMIDS";
const SCHEMER = "TRAIT_SCHEMER_ARCHETYPE";

// One match, by its own GameId. Both uploads carry it, which is what makes
// them two saves of one match rather than two matches.
const XML_GAME_ID = "MATCH-DOUBLE-UPLOAD";

let alice: TestUser;
let bob: TestUser;

const SHARED = {
	winnerIndex: 0 as const,
	match: { xmlGameId: XML_GAME_ID },
	// Alice's seat built the Pyramids and opened with a Schemer.
	wonders: [{ player_id: 0, wonder: PYRAMIDS, completed_turn: 30 }],
	rulers: [{ player: 0, archetype: SCHEMER }],
};

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	alice = await makeUser({ displayName: "Alice" });
	bob = await makeUser({ displayName: "Bob" });

	// Each player uploads the same match from their own perspective, claiming
	// their own seat. Claiming it is also what links that seat's online id to
	// the account (captureOnlineIds), so the *other* upload's copy of the same
	// seat resolves to the same person.
	for (const [user, uploaderIndex] of [
		[alice, 0],
		[bob, 1],
	] as const) {
		const res = await postMultipart({
			path: "/v1/games",
			form: await buildUploadFormData({ ...SHARED, uploaderIndex }),
			as: user,
		});
		expect(res.status).toBe(201);
	}
});

// `null` is the anonymous caller. Not `undefined`, which a default parameter
// cannot tell from an omitted argument.
async function ask(
	qs: string,
	as: TestUser | null = alice,
): Promise<Response> {
	return request.get({ path: `/v1/query?${qs}`, as: as ?? undefined });
}

interface QueryBody {
	selection: string;
	columns: { key: string; label: string; role: string }[];
	rows: Record<string, string | number | null>[];
	row_count: number;
	truncated: boolean;
	measure: { key: string; unit: string; note: string };
}

async function rowsOf(qs: string): Promise<QueryBody["rows"]> {
	const res = await ask(qs);
	expect(res.status).toBe(200);
	return (await res.json<QueryBody>()).rows;
}

describe("the gate", () => {
	it("refuses an anonymous caller", async () => {
		const res = await ask("source=games&measure=matches", null);
		expect(res.status).toBe(401);
	});

	it("serves the catalog without one", async () => {
		// The vocabulary reads nothing and is the same bytes for everyone, so
		// it is not behind the door that spending an aggregation is behind.
		const res = await request.get({ path: "/v1/query/catalog" });
		expect(res.status).toBe(200);
		const body = await res.json<{ sources: { key: string }[] }>();
		expect(body.sources.map((s) => s.key)).toContain("wonder_events");
	});
});

describe("a selection that isn't one", () => {
	it("names the key it refused", async () => {
		const res = await ask("source=games&measure=matches&f=secret:in:x");
		expect(res.status).toBe(400);
		const body = await res.json<{ code: string; error: string }>();
		expect(body.code).toBe("INVALID_QUERY");
		expect(body.error).toContain("secret");
	});

	it("refuses a column the catalog does not carry", async () => {
		// The allowlist is the catalog, so this is a parse failure rather than
		// a query that returns nothing.
		for (const qs of [
			"source=player_summaries&measure=matches&dim=online_id",
			"source=player_summaries&measure=matches&f=online_id:in:steam:1",
			"source=users&measure=matches",
		]) {
			expect((await ask(qs)).status, qs).toBe(400);
		}
	});
});

describe("a count declares what it counts", () => {
	it("counts one match for two uploads of it", async () => {
		const rows = await rowsOf("source=games&measure=matches");
		expect(rows).toEqual([{ value: 1 }]);
	});

	it("counts two saves for the same pair", async () => {
		// Not a bug in the first number — a different question, which is why
		// the unit is on the measure rather than on the asking.
		const rows = await rowsOf("source=games&measure=saves");
		expect(rows).toEqual([{ value: 2 }]);
	});

	it("counts each seat of the match once", async () => {
		const rows = await rowsOf("source=player_summaries&measure=seats");
		expect(rows).toEqual([{ value: 2 }]);
	});

	it("counts one wonder for the two rows that record it", async () => {
		const rows = await rowsOf("source=wonder_events&measure=wonders_built");
		expect(rows).toEqual([{ value: 1 }]);
	});

	it("counts the winner's win once", async () => {
		const rows = await rowsOf("source=player_summaries&measure=wins");
		expect(rows).toEqual([{ value: 1 }]);
	});
});

describe("identity", () => {
	it("resolves both seats to their accounts across both uploads", async () => {
		// Alice claimed seat 0 and Bob seat 1, each in their own upload. The
		// other upload's copy of each seat carries the same online id, which
		// now names exactly one account — so four seat rows resolve to two
		// people, each with one match.
		const rows = await rowsOf(
			"source=player_summaries&dim=player&measure=matches&sort=dimension_asc",
		);
		expect(rows).toEqual([
			{ player: "Alice", player_id: alice.userId, player_slug: null, value: 1 },
			{ player: "Bob", player_id: bob.userId, player_slug: null, value: 1 },
		]);
	});

	it("keeps a seat nothing resolves rather than dropping it", async () => {
		// An answer that quietly omits the seats it could not name reads as a
		// complete answer and is short. Modelled by seating an AI, which has
		// no account by construction.
		const res = await postMultipart({
			path: "/v1/games",
			form: await buildUploadFormData({
				winnerIndex: 0,
				humans: 1,
				aiPlayer: true,
				match: { xmlGameId: "MATCH-WITH-AI" },
			}),
			as: alice,
		});
		expect(res.status).toBe(201);

		const rows = await rowsOf(
			"source=player_summaries&dim=player&measure=seats" +
				"&f=is_human:in:0&sort=dimension_asc",
		);
		expect(rows).toEqual([
			{ player: null, player_id: null, player_slug: null, value: 1 },
		]);
	});
});

describe("the issue's acceptance questions", () => {
	it("Q1 — which players built the Pyramids", async () => {
		const rows = await rowsOf(
			`source=wonder_events&dim=player&measure=matches&f=wonder:in:${PYRAMIDS}`,
		);
		expect(rows).toEqual([
			{ player: "Alice", player_id: alice.userId, player_slug: null, value: 1 },
		]);
	});

	it("Q1 — narrowed to a tournament nobody's game is in", async () => {
		// The tournament filter is a subquery over completed matches; an id
		// with no matches selects nothing rather than everything.
		const rows = await rowsOf(
			`source=wonder_events&dim=player&measure=matches` +
				`&f=wonder:in:${PYRAMIDS}&f=tournament:in:${"t".repeat(21)}`,
		);
		expect(rows).toEqual([]);
	});

	it("Q2 — how often a player played a nation with a Schemer ruler", async () => {
		const rows = await rowsOf(
			"source=player_summaries&dim=player&measure=matches" +
				`&f=nation:in:${EGYPT}&f=starting_archetype:in:${SCHEMER}`,
		);
		// One, not two: the count the issue names as inflated by exactly this
		// double upload.
		expect(rows).toEqual([
			{ player: "Alice", player_id: alice.userId, player_slug: null, value: 1 },
		]);
	});
});

describe("the response", () => {
	it("echoes the canonical spelling of the question", async () => {
		const res = await ask(
			"limit=50&measure=matches&source=player_summaries&dim=nation",
		);
		const body = await res.json<QueryBody>();
		// Params in the catalog's order, the default row cap dropped.
		expect(body.selection).toBe(
			"source=player_summaries&dim=nation&measure=matches",
		);
	});

	it("says which column is which", async () => {
		const res = await ask(
			"source=player_summaries&dim=nation&measure=matches",
		);
		const body = await res.json<QueryBody>();
		expect(body.columns).toEqual([
			{ key: "nation", label: "Nation", role: "dimension", type: "enum" },
			{ key: "value", label: "Matches", role: "measure", type: "number" },
		]);
		expect(body.measure.unit).toBe("match");
		expect(body.measure.note.length).toBeGreaterThan(0);
	});

	it("says when the row cap cut the answer short", async () => {
		const full = await ask("source=player_summaries&dim=nation&measure=seats");
		expect((await full.json<QueryBody>()).truncated).toBe(false);

		const capped = await ask(
			"source=player_summaries&dim=nation&measure=seats&limit=1",
		);
		const body = await capped.json<QueryBody>();
		expect(body.rows).toHaveLength(1);
		expect(body.truncated).toBe(true);
	});

	it("is storable by a shared cache, with no browser cache", async () => {
		// The selection is entirely in the query string, which is the cache
		// key — the reason canonicalSelection exists.
		const res = await ask("source=games&measure=matches");
		expect(res.headers.get("Cache-Control")).toBe(
			"public, max-age=0, s-maxage=60",
		);
	});
});

describe("the corpus", () => {
	it("is public games only", async () => {
		await env.SHARE_DB.prepare("UPDATE games SET is_public = 0").run();
		const rows = await rowsOf("source=games&measure=saves");
		expect(rows).toEqual([{ value: 0 }]);
		await env.SHARE_DB.prepare("UPDATE games SET is_public = 1").run();
	});
});
