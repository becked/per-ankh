// `./per-ankh prod migrate` — apply pending D1 migrations to remote.
// Standalone version of the migrate phase used in `deploy`.

import { listPendingMigrations } from "../checks/migrations";
import { applyRemoteMigrations } from "../deploy/migrate";
import type { ProdOpts } from "../types";
import { bold, info, ok } from "../../lib/format";
import { confirmYesNo } from "../../lib/confirm";
import { printJson } from "../../lib/cli";

export async function run(_argv: string[], opts: ProdOpts): Promise<void> {
	info("Listing pending migrations...");
	const r = await listPendingMigrations();
	if (r.error) {
		throw new Error(`Could not list pending migrations: ${r.error}`);
	}

	if (opts.json) {
		printJson({ pending: r.pending });
		return;
	}

	if (r.pending.length === 0) {
		ok("No pending migrations.");
		return;
	}

	process.stdout.write(
		`\n${bold(`${r.pending.length} pending migration(s):`)}\n`,
	);
	for (const m of r.pending) {
		process.stdout.write(`  ${m}\n`);
	}
	process.stdout.write("\n");

	if (opts.dryRun) {
		info("--dry-run: not applying.");
		return;
	}

	if (!opts.yes) {
		const yes = await confirmYesNo("Apply these to remote D1?");
		if (!yes) {
			info("Cancelled.");
			return;
		}
	}

	await applyRemoteMigrations();
	ok(`Applied ${r.pending.length} migration(s).`);
}
