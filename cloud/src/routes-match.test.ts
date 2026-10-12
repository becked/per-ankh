import { describe, expect, it } from "vitest";
import { matchRouteKey } from "./index";

// Guards which route a path dispatches to, for the one place in the table
// where two patterns overlap on purpose: the public per-tournament reads take
// the tournament id *or* its slug (`tournamentPath`, index.ts), while the
// mutations and the two admin reads beside them stay keyed on the id alone.
//
// Table order is the matching rule, and the overlap is real rather than
// theoretical — the id alphabet contains the slug's, so a 21-character slug
// matches the id pattern too. Reading the table cannot tell you which arm wins;
// this can.

// A 21-char nanoid, the id shape (`[A-Za-z0-9_-]{21}`), carrying both an
// uppercase letter and an underscore so it is not also a legal slug.
const ID = "Ab3_xyzXYZ0123456789-";
// The same length, drawn only from the slug alphabet — so it satisfies *both*
// patterns and is the case that decides nothing by shape.
const SLUG_21 = "winter-cup-2026-abcde";
// An ordinary slug, longer than any id.
const SLUG = "old-world-open-2026";
// A match id is always the nanoid shape — matches have no slug.
const MATCH_ID = "Mch3_xyzXYZ012345678-";

// Every read widened to accept both forms, with the route key it must reach.
const ID_OR_SLUG: Record<string, string> = {
	"/standings": "GET /v1/tournaments/:id/standings",
	"/bracket": "GET /v1/tournaments/:id/bracket",
	"/stats": "GET /v1/tournaments/:id/stats",
	"/stats/games": "GET /v1/tournaments/:id/stats/games",
	"/stats/records": "GET /v1/tournaments/:id/stats/records",
	"/rounds": "GET /v1/tournaments/:id/rounds",
	"/matches": "GET /v1/tournaments/:id/matches",
	"/video-archive": "GET /v1/tournaments/:id/video-archive",
};

describe("tournament reads accept an id or a slug", () => {
	for (const [suffix, key] of Object.entries(ID_OR_SLUG)) {
		it(`${suffix} resolves for all three identifier shapes`, () => {
			for (const ref of [ID, SLUG, SLUG_21]) {
				expect(matchRouteKey("GET", `/v1/tournaments/${ref}${suffix}`)).toBe(
					key,
				);
			}
		});
	}

	it("match detail takes a slug for the tournament, an id for the match", () => {
		const key = "GET /v1/tournaments/:id/matches/:match_id";
		for (const ref of [ID, SLUG, SLUG_21]) {
			expect(
				matchRouteKey("GET", `/v1/tournaments/${ref}/matches/${MATCH_ID}`),
			).toBe(key);
		}
		// A slug in the match position has no route — matches are id-keyed, and
		// widening the first segment must not have widened the second.
		expect(
			matchRouteKey("GET", `/v1/tournaments/${SLUG}/matches/${SLUG}`),
		).toBeNull();
	});
});

describe("the reads that stay id-only", () => {
	// Both go through their own lookup rather than loadViewableTournament, so
	// neither gained the slug form — asserted so a later `tournamentPath`
	// sweep over the table is a deliberate change and not a quiet one.
	const ID_ONLY: Record<string, string> = {
		"/export": "GET /v1/tournaments/:id/export",
		"/admins": "GET /v1/tournaments/:id/admins",
	};
	for (const [suffix, key] of Object.entries(ID_ONLY)) {
		it(`${suffix} takes an id and not a slug`, () => {
			expect(matchRouteKey("GET", `/v1/tournaments/${ID}${suffix}`)).toBe(key);
			expect(
				matchRouteKey("GET", `/v1/tournaments/${SLUG}${suffix}`),
			).toBeNull();
		});
	}

	it("mutations on a match take an id, not a slug", () => {
		expect(
			matchRouteKey("PATCH", `/v1/tournaments/${ID}/matches/${MATCH_ID}`),
		).toBe("PATCH /v1/tournaments/:id/matches/:match_id");
		expect(
			matchRouteKey("PATCH", `/v1/tournaments/${SLUG}/matches/${MATCH_ID}`),
		).toBeNull();
	});
});

describe("detail-by-slug still owns the bare path", () => {
	it("routes a slug and an id to the slug handler", () => {
		// The bare path has one route either way: the widened reads all carry a
		// suffix, so none of them can swallow it.
		expect(matchRouteKey("GET", `/v1/tournaments/${SLUG}`)).toBe(
			"GET /v1/tournaments/:slug",
		);
		expect(matchRouteKey("GET", `/v1/tournaments/${SLUG_21}`)).toBe(
			"GET /v1/tournaments/:slug",
		);
	});

	it("is not reached by an identifier the slug pattern rejects", () => {
		// `GET /v1/tournaments/:slug` is the slug regex alone — an id with an
		// uppercase letter or an underscore is not a slug, so the bare path
		// 404s for it, exactly as before.
		expect(matchRouteKey("GET", `/v1/tournaments/${ID}`)).toBeNull();
	});

	it("still matches the list and rejects an over-long identifier", () => {
		expect(matchRouteKey("GET", "/v1/tournaments")).toBe("GET /v1/tournaments");
		const tooLong = `a${"b".repeat(64)}`;
		expect(
			matchRouteKey("GET", `/v1/tournaments/${tooLong}/standings`),
		).toBeNull();
	});
});
