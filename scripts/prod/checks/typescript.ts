// Worker-side TypeScript strict check. Frontend TS is covered by
// `npm run check` (svelte-check) which the npm.check check already runs.

import { runCaptured } from "../../lib/shell";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { CheckResult } from "../types";

const CLOUD_DIR = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"cloud",
);

export async function runTypescriptChecks(): Promise<CheckResult[]> {
	const start = Date.now();
	const r = await runCaptured("npx", ["tsc", "--noEmit"], {
		cwd: CLOUD_DIR,
	});
	const durationMs = Date.now() - start;
	if (r.code === 0) {
		return [
			{
				name: "ts.worker",
				status: "pass",
				blocking: true,
				durationMs,
			},
		];
	}
	const out = `${r.stdout}\n${r.stderr}`.trim();
	return [
		{
			name: "ts.worker",
			status: "fail",
			blocking: true,
			details: out || `tsc --noEmit exited ${r.code}`,
			durationMs,
		},
	];
}
