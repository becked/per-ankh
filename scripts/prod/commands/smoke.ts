// `./per-ankh prod|staging smoke` — HTTP probes against the live environment.

import { runSmokeProbes } from "../deploy/smoke";
import type { ProdOpts } from "../types";
import type { CloudEnv } from "../../lib/environments";
import { bold, dim, green, info, red } from "../../lib/format";
import { printJson } from "../../lib/cli";

export async function run(
	_argv: string[],
	opts: ProdOpts,
	env: CloudEnv,
): Promise<void> {
	info(`Running smoke probes against ${env.name}...`);
	const results = await runSmokeProbes(env);

	if (opts.json) {
		printJson(results);
		if (results.some((r) => r.status === "fail")) process.exit(1);
		return;
	}

	process.stdout.write(`\n${bold("Smoke probes:")}\n`);
	for (const r of results) {
		const label = `${r.probe.label.padEnd(10)} ${r.probe.url}`;
		const status =
			r.status === "pass" ? bold(green("PASS")) : bold(red("FAIL"));
		const code = r.actualStatus !== undefined ? ` ${r.actualStatus}` : "";
		const ms = dim(`${r.durationMs}ms`);
		process.stdout.write(`  ${label}  ${status}${code}  ${ms}\n`);
		if (r.detail) {
			process.stdout.write(`        ${r.detail}\n`);
		}
	}
	process.stdout.write("\n");
	if (results.some((r) => r.status === "fail")) process.exit(1);
}
