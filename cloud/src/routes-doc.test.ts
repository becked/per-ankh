import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTE_KEYS } from "./index";

// (`node:fs` / `import.meta.url` typed by test-node.d.ts — the worker tsconfig
// ships @cloudflare/workers-types only; this test runs on Vitest's Node pool.)

// Drift guard: docs/api-reference.md must document exactly the routes in the
// ROUTES table (cloud/src/index.ts) — one heading per route, no more and no
// fewer. Adding, renaming, or removing an endpoint fails this until the doc is
// updated in the same change. Endpoint headings are the exact "METHOD /path"
// route key wrapped in backticks, e.g.  ### `GET /v1/tournaments/:id/stats`

const DOC_PATH = new URL("../../docs/api-reference.md", import.meta.url);

// `### ` + backticked METHOD + space + path. Anchored to line start so inline
// `code` in tables/prose (which isn't a heading) never matches.
const HEADING_RE = /^###\s+`(GET|POST|PATCH|PUT|DELETE)\s+(\/\S+)`/gm;

function documentedRouteKeys(): string[] {
	const md = readFileSync(DOC_PATH, "utf8");
	return [...md.matchAll(HEADING_RE)].map((m) => `${m[1]} ${m[2]}`);
}

describe("api-reference.md ⇄ ROUTES", () => {
	const documented = documentedRouteKeys();
	const documentedSet = new Set(documented);
	const registered = new Set(ROUTE_KEYS);

	it("documents every registered route", () => {
		const missing = [...registered].filter((r) => !documentedSet.has(r)).sort();
		expect(
			missing,
			`Routes missing a heading in docs/api-reference.md:\n${missing.join("\n")}`,
		).toEqual([]);
	});

	it("has no heading for a route that is not registered", () => {
		const extra = [...documentedSet].filter((r) => !registered.has(r)).sort();
		expect(
			extra,
			`docs/api-reference.md documents routes not in ROUTES:\n${extra.join("\n")}`,
		).toEqual([]);
	});

	it("has no duplicate endpoint headings", () => {
		const dups = [
			...new Set(documented.filter((r, i) => documented.indexOf(r) !== i)),
		].sort();
		expect(dups, `Duplicate endpoint headings:\n${dups.join("\n")}`).toEqual(
			[],
		);
	});
});
