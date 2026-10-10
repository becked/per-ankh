import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHARED_CACHE_ROUTE_KEYS } from "./index";
import { errorResponse, jsonResponse } from "./util";

// (`node:fs` / `import.meta.url` typed by test-node.d.ts — the worker tsconfig
// ships @cloudflare/workers-types only; this test runs on Vitest's Node pool.)

// Guards the cache posture of the GET surface, now that Workers Cache runs in
// front of the Worker (`[cache]` in cloud/wrangler.toml).
//
// Two halves, the same shape as stale-tolerant-routes.test.ts. A route whose
// response may be stored in a cache shared between viewers carries
// `sharedCache` in the ROUTES table and an entry here saying why that is safe;
// a route in one and not the other fails this file. And because the hazard is
// a response that says nothing at all — an unheadered `200` gets 7200s of
// heuristic freshness under a key that holds no `Cookie` — the default itself
// is pinned below rather than left to inspection.

// Every route allowed into a shared cache, with the audit that justified it.
// A route qualifies only if its body does not depend on who asked, or if a
// `Vary` puts the dependence into the cache key — the flag's doc comment in
// index.ts spells out both disqualifiers.
const REVIEWED: Record<string, string> = {
	// Reads no session at all, so there is no second body: the PII stance is
	// the same for every caller.
	"GET /v1/games/public-recent": "no session read",
	// Anonymous, and the board and window are both query parameters, which are
	// in the cache key.
	"GET /v1/stats/players": "no session read",
	// The exception to the rule rather than an instance of it: two bodies on
	// one URL, separated by `Vary: Cookie, Origin`. The cookie-less key can
	// only ever hold the stripOnlineIds variant, and the owner's body is
	// `private, no-store` so it is never stored.
	"GET /v1/games/:id": "two bodies, separated by Vary: Cookie",
	// Session-gated but not viewer-dependent — `is_public = 1` is the whole
	// visibility rule, so every signed-in caller reads the same bytes. A hit
	// answers without running the handler, so the gate stops being checked;
	// accepted because the gate is on spending an aggregation and a hit spends
	// nothing. See the route's comment.
	"GET /v1/stats": "viewer-independent payload",
	"GET /v1/stats/records": "viewer-independent payload",
	// Public, sessionless, no parameters: one precomputed slice for everyone.
	"GET /v1/home-summary": "no session read",
	// Pre-assembled feeds, identical for every caller.
	"GET /v1/creator-videos": "no session read",
	// Viewer-independent by construction — which visibility rule it uses was
	// chosen *because* this response is shared (docs/api-reference.md).
	"GET /v1/tournament-videos": "no session read",
	"GET /v1/featured-videos": "no session read",
};

// Every source site that hands a client a shared-cache directive, by file.
// The map is the other direction of the guard: the flags above say which
// routes a reviewer cleared, and this says no *handler* started serving
// `public` without one. Counts, not routes, because the mapping isn't 1:1 —
// `globalStatsResponse` serves two routes from one site, so nine flags stand
// on eight sites.
const PUBLIC_DIRECTIVE_SITES: Record<string, number> = {
	// handleCreatorVideos.
	"channels.ts": 1,
	// handlePublicFeaturedVideos.
	"featured.ts": 1,
	// handlePublicRecentGames, and handleGameDetail's non-owner branch.
	"games.ts": 2,
	// globalStatsResponse (both /stats reads), handlePlayerLeaderboard,
	// handleHomeSummary.
	"stats/handlers.ts": 3,
	// handleTournamentVideosFeed.
	"tournament/public.ts": 1,
};

const SRC_DIR = new URL(".", import.meta.url);

// The directive literal, not the header name: `private, no-store` and
// `private, max-age=…` are the postures that need no review, and a response
// that sets nothing is caught by the default instead. Matches inside a ternary
// (handleGameDetail) as readily as a plain property, which is the form a
// second two-body route would reach for.
//
// Inline literals only. A directive assembled at runtime is out of a regex's
// reach — declare `sharedCache` because the invariant says so, not because
// this test can see you.
const PUBLIC_DIRECTIVE_RE = /"public,\s*max-age=/g;

function sourceFiles(dir: URL, prefix = ""): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		if (e.isDirectory()) {
			return sourceFiles(new URL(`${e.name}/`, dir), `${prefix}${e.name}/`);
		}
		if (!e.name.endsWith(".ts") || e.name.endsWith(".test.ts")) return [];
		return [`${prefix}${e.name}`];
	});
}

describe("the default cache posture", () => {
	// The prerequisite for everything else in this file: opting *in* is the
	// deliberate act only while opting out is automatic.
	it("is private, no-store on every JSON response", () => {
		expect(
			jsonResponse({ ok: true }, 200, {}).headers.get("Cache-Control"),
		).toBe("private, no-store");
	});

	it("is private, no-store on every error response", () => {
		expect(
			errorResponse("Unauthorized", 401, {}, "UNAUTHORIZED").headers.get(
				"Cache-Control",
			),
		).toBe("private, no-store");
	});

	it("is not overridable through the cors argument", () => {
		// `...cors` spreads after the default in jsonResponse, so a caller that
		// put a directive in there would silently win. Nothing does today and
		// nothing should — the posture belongs on the response, not on the CORS
		// helper that every route shares.
		const headers = jsonResponse({}, 200, { Vary: "Origin" }).headers;
		expect(headers.get("Cache-Control")).toBe("private, no-store");
		expect(headers.get("Vary")).toBe("Origin");
	});
});

describe("shared-cache routes", () => {
	const flagged = new Set(SHARED_CACHE_ROUTE_KEYS);
	const reviewed = new Set(Object.keys(REVIEWED));

	it("has a reviewed entry for every flagged route", () => {
		const unreviewed = [...flagged].filter((r) => !reviewed.has(r)).sort();
		expect(
			unreviewed,
			`Routes flagged sharedCache in ROUTES with no entry in this file.\n` +
				`A shared entry is served without the handler running, so nothing\n` +
				`authorizes, rate-limits or audits — and Cookie is not in the cache\n` +
				`key. Confirm the body does not depend on who asked (or that a Vary\n` +
				`puts the dependence in the key), then add it to REVIEWED with the\n` +
				`reason:\n${unreviewed.join("\n")}`,
		).toEqual([]);
	});

	it("has no reviewed entry for a route that is no longer flagged", () => {
		const stale = [...reviewed].filter((r) => !flagged.has(r)).sort();
		expect(
			stale,
			`Listed here but not flagged sharedCache in ROUTES:\n${stale.join("\n")}`,
		).toEqual([]);
	});

	it("flags only GET routes", () => {
		// A shared cache stores GET responses, so a flag on anything else is a
		// mistake about what the flag means rather than a posture to review.
		const notGet = [...flagged].filter((r) => !r.startsWith("GET ")).sort();
		expect(
			notGet,
			`sharedCache is about stored GET responses:\n${notGet.join("\n")}`,
		).toEqual([]);
	});
});

describe("public directives stay declared", () => {
	it("has no shared-cache directive outside the reviewed files", () => {
		const found: Record<string, number> = {};
		for (const rel of sourceFiles(SRC_DIR)) {
			const src = readFileSync(new URL(rel, SRC_DIR), "utf8");
			const n = [...src.matchAll(PUBLIC_DIRECTIVE_RE)].length;
			if (n > 0) found[rel] = n;
		}
		expect(
			found,
			`A handler serving a \`public, max-age=…\` directive puts its response\n` +
				`into a cache shared between viewers (cloud/wrangler.toml's [cache]\n` +
				`block). Flag the route \`sharedCache\` in ROUTES, add it to REVIEWED\n` +
				`above, and update the count for its file here.`,
		).toEqual(PUBLIC_DIRECTIVE_SITES);
	});
});
