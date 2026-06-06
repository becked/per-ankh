// `./per-ankh backup` — snapshot D1 to a portable SQLite file. Thin CLI
// shell over the shared engine in scripts/lib/d1-backup.ts (which documents
// the artifacts, targets, and rationale; `staging reclone` is the other
// caller).

import { parseFlags, flagString } from "./lib/cli";
import { ok } from "./lib/format";
import { runBackup } from "./lib/d1-backup";

function printHelp(): void {
	process.stdout.write(
		[
			"per-ankh backup — snapshot D1 to a .sql + .sqlite file",
			"",
			"Usage:",
			"  ./per-ankh backup [--local] [--out DIR]",
			"",
			"Writes two artifacts under the output directory:",
			"  <base>.sql      wrangler dump (raw replay into D1 fails on FK order —",
			"                  re-emit via prepareOrderedImport, scripts/prod/deploy/reclone.ts)",
			"  <base>.sqlite   the dump materialized into a queryable SQLite DB",
			"",
			"Flags:",
			"  --local         Export the local .wrangler dev state (default: remote prod)",
			"  --out DIR       Output directory (default: backups/ at repo root)",
			"  --help          Show this help",
			"",
		].join("\n"),
	);
}

export async function main(argv: string[]): Promise<void> {
	const { flags } = parseFlags(argv);

	if (flags.help === true) {
		printHelp();
		return;
	}

	await runBackup({
		local: flags.local === true,
		outDir: flagString(flags, "out"),
	});
	ok("backup complete");
}
