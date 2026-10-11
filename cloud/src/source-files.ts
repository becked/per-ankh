// The recursive walk over this directory's own source, shared by the two
// invariant guards that scan for an inline literal: `EVENTS_WRITE_RE` in
// stale-tolerant-routes.test.ts and `PUBLIC_DIRECTIVE_RE` in
// shared-cache-routes.test.ts. Both need the same list — every `.ts` under
// cloud/src except the tests themselves — and had the same walker.
//
// **Not worker code.** Nothing in the dispatch graph imports this and nothing
// should: `node:fs` does not exist in workerd, and the only reason the import
// type-checks is the ambient shim in test-node.d.ts. It lives in src/ rather
// than cloud/test/helpers/ because cloud/tsconfig.json includes `src/**/*.ts`
// only, so a helper anywhere else is invisible to `npm run typecheck`.
import { readdirSync } from "node:fs";

// Paths are returned relative to `dir`, which is what both guards key their
// per-file expectations on (`"stats/handlers.ts"`, not an absolute path), and
// what they re-resolve against the same base to read each file.
export function sourceFiles(dir: URL, prefix = ""): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		if (e.isDirectory()) {
			return sourceFiles(new URL(`${e.name}/`, dir), `${prefix}${e.name}/`);
		}
		if (!e.name.endsWith(".ts") || e.name.endsWith(".test.ts")) return [];
		return [`${prefix}${e.name}`];
	});
}
