// Router for `./per-ankh prod <subcommand>`. Mirrors scripts/admin/index.ts.

import { err } from "../lib/format";
import type { ProdOpts } from "./types";

import * as preflight from "./commands/preflight";
import * as deploy from "./commands/deploy";
import * as migrate from "./commands/migrate";
import * as smoke from "./commands/smoke";
import * as status from "./commands/status";

function printHelp(): void {
	process.stdout.write(
		[
			"per-ankh prod — production deploy & monitoring",
			"",
			"Usage:",
			"  ./per-ankh prod <command> [flags]",
			"",
			"Commands:",
			"  preflight     Run every safety check, exit non-zero on any failure.",
			"  deploy        Full deploy: preflight → migrate → worker → frontend → smoke.",
			"  migrate       Apply pending D1 migrations (with confirm + preview).",
			"  smoke         Live HTTP probes against per-ankh.app, api, legacy.",
			"  status        Show local git, deployed versions, secrets, pending migrations.",
			"",
			"Global flags:",
			"  --dry-run         Run checks + print plan; skip side effects.",
			"  --yes             Skip confirmation prompts.",
			"  --allow-dirty     Allow deploy with uncommitted changes.",
			"  --allow-branch    Allow deploy from a branch other than main.",
			"  --skip-checks     Skip pre-flight entirely (emergency hotfix).",
			"  --skip-worker     Skip the API Worker deploy step.",
			"  --skip-frontend   Skip the frontend build + deploy step.",
			"  --skip-smoke      Skip post-deploy smoke probes.",
			"  --json            Machine-readable output for preflight/smoke/status.",
			"",
		].join("\n"),
	);
}

function parseProdOpts(argv: string[]): { opts: ProdOpts; rest: string[] } {
	const opts: ProdOpts = {
		json: false,
		yes: false,
		dryRun: false,
		allowDirty: false,
		allowBranch: false,
		skipChecks: false,
		skipWorker: false,
		skipFrontend: false,
		skipSmoke: false,
	};
	const rest: string[] = [];
	for (const a of argv) {
		switch (a) {
			case "--json":
				opts.json = true;
				break;
			case "--yes":
				opts.yes = true;
				break;
			case "--dry-run":
				opts.dryRun = true;
				break;
			case "--allow-dirty":
				opts.allowDirty = true;
				break;
			case "--allow-branch":
				opts.allowBranch = true;
				break;
			case "--skip-checks":
				opts.skipChecks = true;
				break;
			case "--skip-worker":
				opts.skipWorker = true;
				break;
			case "--skip-frontend":
				opts.skipFrontend = true;
				break;
			case "--skip-smoke":
				opts.skipSmoke = true;
				break;
			default:
				rest.push(a);
		}
	}
	return { opts, rest };
}

export async function main(argv: string[]): Promise<void> {
	const { opts, rest } = parseProdOpts(argv);
	const sub = rest[0];
	const subArgs = rest.slice(1);

	switch (sub) {
		case "preflight":
			return preflight.run(subArgs, opts);
		case "deploy":
			return deploy.run(subArgs, opts);
		case "migrate":
			return migrate.run(subArgs, opts);
		case "smoke":
			return smoke.run(subArgs, opts);
		case "status":
			return status.run(subArgs, opts);
		case undefined:
		case "help":
		case "--help":
		case "-h":
			printHelp();
			return;
		default:
			err(`Unknown prod subcommand: ${sub}`);
			process.stderr.write("\n");
			printHelp();
			process.exit(1);
	}
}
