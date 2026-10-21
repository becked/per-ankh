// Read a KEY=VALUE dotenv-style vars file (the .dev.vars / .staging.vars
// format). Missing file yields an empty object — callers decide whether
// absence is an error or a degraded mode.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The local Worker's own vars file. `wrangler dev` loads cloud/.dev.vars, so it
// is the one place a CLI can read the value the Worker `./per-ankh dev` is
// running actually holds — which is why three callers want this exact path (the
// channel resolver's YouTube key, the reparse sweep's admin token, the UX-review
// discovery's admin id) and why it is defined once here rather than re-derived
// per caller. Never authoritative for a remote target: there the file has no
// say over what the deployed Worker holds.
export const DEV_VARS_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"cloud",
	".dev.vars",
);

export function readDotVars(path: string): Record<string, string> {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return {};
	}
	const vars: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq <= 0) continue;
		// Split on the first "=" only — values may contain "=".
		vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
	}
	return vars;
}
