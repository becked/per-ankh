import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STALE_TOLERANT_ROUTE_KEYS } from "./index";

// (`node:fs` / `import.meta.url` typed by test-node.d.ts — the worker tsconfig
// ships @cloudflare/workers-types only; this test runs on Vitest's Node pool.)

// Guards the two halves of the D1 read-replication scheme in d1.ts.
//
// Flagging a route `staleTolerant` moves its reads onto replicas, which is a
// correctness decision and not a perf tweak — so it takes two edits, the flag
// in the ROUTES table and an entry here. A route that shows up in one and not
// the other fails this file.

// Every route allowed to serve replica reads, with the audit that justified it.
// A route qualifies only if nothing in its call graph writes to D1 and nothing
// decides on a concurrent request's write — the flag's doc comment in index.ts
// spells out both tests.
const REVIEWED: Record<string, string> = {
	// stats/resolve.ts + stats/aggregate.ts are SELECT-only, and the bundle
	// cache is KV (stats/cache.ts:83), not D1. Note the 24h cache entry is why
	// the session anchors first-primary and not first-unconstrained: whatever
	// this route reads is then served for a day.
	"GET /v1/users/:user_id/stats": "SELECT-only call graph",
	// The same corpus and the same call graph — one handler preamble serves
	// both payloads, and a miss on either runs the one SELECT-only build that
	// writes both KV keys.
	"GET /v1/users/:user_id/stats/records": "SELECT-only call graph",
};

// `events` is both audit log and rate-limit counter, so it always runs on the
// primary via EVENTS_DB (see d1.ts). The compiler enforces that for reads —
// every helper that counts events takes a real `D1Database`, which a session
// handle isn't — but an inline `SHARE_DB.prepare("INSERT INTO events …")` would
// still compile, so the writes are checked here.
//
// One site is exempt, on a route that is never `staleTolerant` and so holds a
// raw primary binding anyway. The count is exact: a second SHARE_DB events
// write in that file fails this test rather than joining the exemption.
const EXEMPT_EVENTS_WRITES: Record<string, number> = {
	// Member of the tournament-create transactional batch; the slug-UNIQUE 409
	// depends on that batch failing as a unit.
	"tournament/admin.ts": 1,
};

const SRC_DIR = new URL(".", import.meta.url);

// Any receiver, not just `env.SHARE_DB` — a helper that takes the handle as a
// `db` parameter is exactly the indirection a new caller reaches for, and a
// guard that only knew the direct form would miss it. The `\s*` spans
// Prettier's line break in `await db\n  .prepare(`, and the OR clause covers
// `INSERT OR IGNORE/REPLACE INTO`.
//
// This catches the inline-literal form only. SQL held in a const, or assembled
// at runtime, is out of a regex's reach — write events through EVENTS_DB
// because the invariant says so, not because this test can see you.
const EVENTS_WRITE_RE =
	/([\w.]+)\s*\.prepare\(\s*[`"]\s*INSERT(?:\s+OR\s+\w+)?\s+INTO\s+events\b/gi;
const EVENTS_HANDLE = "env.EVENTS_DB";

function sourceFiles(dir: URL, prefix = ""): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		if (e.isDirectory()) {
			return sourceFiles(new URL(`${e.name}/`, dir), `${prefix}${e.name}/`);
		}
		if (!e.name.endsWith(".ts") || e.name.endsWith(".test.ts")) return [];
		return [`${prefix}${e.name}`];
	});
}

describe("stale-tolerant routes", () => {
	const flagged = new Set(STALE_TOLERANT_ROUTE_KEYS);
	const reviewed = new Set(Object.keys(REVIEWED));

	it("has a reviewed entry for every flagged route", () => {
		const unreviewed = [...flagged].filter((r) => !reviewed.has(r)).sort();
		expect(
			unreviewed,
			`Routes flagged staleTolerant in ROUTES with no entry in this file.\n` +
				`Replica reads may lag the primary — confirm the route's whole call\n` +
				`graph is write-free and decides nothing on a recent write, then add\n` +
				`it to REVIEWED with the reason:\n${unreviewed.join("\n")}`,
		).toEqual([]);
	});

	it("has no reviewed entry for a route that is no longer flagged", () => {
		const stale = [...reviewed].filter((r) => !flagged.has(r)).sort();
		expect(
			stale,
			`Listed here but not flagged staleTolerant in ROUTES:\n${stale.join("\n")}`,
		).toEqual([]);
	});
});

describe("events writes stay on EVENTS_DB", () => {
	it("has no unexpected SHARE_DB events write", () => {
		const found: Record<string, number> = {};
		for (const rel of sourceFiles(SRC_DIR)) {
			const src = readFileSync(new URL(rel, SRC_DIR), "utf8");
			const n = [...src.matchAll(EVENTS_WRITE_RE)].filter(
				(m) => m[1] !== EVENTS_HANDLE,
			).length;
			if (n > 0) found[rel] = n;
		}
		expect(
			found,
			`INSERT INTO events must go through env.EVENTS_DB so the audit write\n` +
				`never anchors a replica session's bookmark (see cloud/src/d1.ts).\n` +
				`Change SHARE_DB to EVENTS_DB, or — if the write must stay in a\n` +
				`transactional batch on SHARE_DB — document it and update the\n` +
				`EXEMPT_EVENTS_WRITES count in this file.`,
		).toEqual(EXEMPT_EVENTS_WRITES);
	});
});
