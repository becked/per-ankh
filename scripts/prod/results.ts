// Pretty-print a CheckResult[] list. Used by both `preflight` and the
// preflight phase of `deploy`.

import { bold, dim, green, red, yellow } from "../lib/format";
import type { CheckResult } from "./types";

function statusLabel(r: CheckResult): string {
	const txt =
		r.status === "pass" ? "PASS" : r.status === "warn" ? "WARN" : "FAIL";
	const colored =
		r.status === "pass"
			? green(txt)
			: r.status === "warn"
				? yellow(txt)
				: red(txt);
	return bold(colored);
}

export function printResults(results: CheckResult[]): void {
	const maxName = Math.max(...results.map((r) => r.name.length));
	process.stdout.write(`\n${bold("Pre-flight results:")}\n`);
	for (const r of results) {
		const duration =
			r.durationMs !== undefined
				? `  ${dim(`(${(r.durationMs / 1000).toFixed(1)}s)`)}`
				: "";
		process.stdout.write(
			`  ${r.name.padEnd(maxName)}  ${statusLabel(r)}${duration}\n`,
		);
		if (r.status !== "pass" && r.details) {
			for (const line of r.details.split("\n")) {
				process.stdout.write(`        ${line}\n`);
			}
		}
	}
	process.stdout.write("\n");
}
