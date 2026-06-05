// Read a KEY=VALUE dotenv-style vars file (the .dev.vars / .staging.vars
// format). Missing file yields an empty object — callers decide whether
// absence is an error or a degraded mode.

import { readFileSync } from "node:fs";

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
