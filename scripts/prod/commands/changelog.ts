// `./per-ankh prod changelog` — preview the deploy changelog entry, or
// write+commit+tag it (used for the one-time backfill and out-of-band
// catch-up runs; the normal path is `prod deploy`, which calls the same
// orchestrator).

import { parseFlags, flagString } from "../../lib/cli";
import { bold, dim, info, ok } from "../../lib/format";
import type { ProdOpts } from "../types";
import { runChangelog } from "../changelog/run";

export async function run(argv: string[], opts: ProdOpts): Promise<void> {
	const { flags } = parseFlags(argv);
	const since = flagString(flags, "since");
	const write = flags.write === true;
	const edit = opts.editChangelog || flags["edit-changelog"] === true;

	const result = await runChangelog({ since, write, edit });

	if (result.skipped) {
		info(`No commits since ${result.since}. Nothing to record.`);
		return;
	}

	if (write) {
		ok(
			`Wrote entry [${result.stamp}], committed, and tagged deploy/${result.stamp}.`,
		);
		process.stdout.write(
			`\n${dim(`(${result.commits.length} commits since ${result.since})`)}\n\n`,
		);
		return;
	}

	process.stdout.write(
		`\n${bold(`Draft changelog entry`)} ${dim(`(since ${result.since}, ${result.commits.length} commits)`)}\n`,
	);
	process.stdout.write(`${"─".repeat(60)}\n\n`);
	process.stdout.write(result.entry);
	process.stdout.write(`\n${dim(`Re-run with --write to persist.`)}\n`);
}
