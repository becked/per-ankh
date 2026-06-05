// Router for `./per-ankh prod <subcommand>` and `./per-ankh staging
// <subcommand>` — the same command set parameterized by a CloudEnv. The only
// surface difference: changelog (CHANGELOG.md + version bump + deploy tag) is
// prod release bookkeeping and isn't offered for staging.

import { err } from "../lib/format";
import type { ProdOpts } from "./types";
import { getEnv, type CloudEnv } from "../lib/environments";

import * as preflight from "./commands/preflight";
import * as deploy from "./commands/deploy";
import * as migrate from "./commands/migrate";
import * as smoke from "./commands/smoke";
import * as status from "./commands/status";
import * as changelog from "./commands/changelog";

function printHelp(env: CloudEnv): void {
	const title =
		env.name === "prod"
			? "per-ankh prod — production deploy & monitoring"
			: "per-ankh staging — staging deploy & monitoring";
	const smokeTargets =
		env.name === "prod"
			? "per-ankh.app, api, legacy"
			: "staging.per-ankh.app, api-staging";
	const deploySteps = env.runsChangelog
		? "preflight → changelog → migrate → worker → frontend → smoke"
		: "preflight → migrate → worker → frontend → smoke";
	process.stdout.write(
		[
			title,
			"",
			"Usage:",
			`  ./per-ankh ${env.name} <command> [flags]`,
			"",
			"Commands:",
			"  preflight     Run every safety check, exit non-zero on any failure.",
			`  deploy        Full deploy: ${deploySteps}.`,
			"  migrate       Apply pending D1 migrations (with confirm + preview).",
			`  smoke         Live HTTP probes against ${smokeTargets}.`,
			"  status        Show local git, deployed versions, secrets, pending migrations.",
			...(env.runsChangelog
				? [
						"  changelog     Preview (default) or --write the deploy changelog entry.",
					]
				: []),
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
			...(env.runsChangelog
				? [
						"  --skip-changelog  Skip changelog generation during deploy.",
						"  --edit-changelog  Open $EDITOR on the changelog before committing.",
					]
				: []),
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
		skipChangelog: false,
		editChangelog: false,
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
			case "--skip-changelog":
				opts.skipChangelog = true;
				break;
			case "--edit-changelog":
				opts.editChangelog = true;
				break;
			default:
				rest.push(a);
		}
	}
	return { opts, rest };
}

async function main(argv: string[], env: CloudEnv): Promise<void> {
	const { opts, rest } = parseProdOpts(argv);
	const sub = rest[0];
	const subArgs = rest.slice(1);

	switch (sub) {
		case "preflight":
			return preflight.run(subArgs, opts, env);
		case "deploy":
			return deploy.run(subArgs, opts, env);
		case "migrate":
			return migrate.run(subArgs, opts, env);
		case "smoke":
			return smoke.run(subArgs, opts, env);
		case "status":
			return status.run(subArgs, opts, env);
		case "changelog":
			if (env.runsChangelog) return changelog.run(subArgs, opts);
			break; // falls out to the unknown-subcommand error for staging
		case undefined:
		case "help":
		case "--help":
		case "-h":
			printHelp(env);
			return;
	}
	err(`Unknown ${env.name} subcommand: ${sub}`);
	process.stderr.write("\n");
	printHelp(env);
	process.exit(1);
}

export async function prodMain(argv: string[]): Promise<void> {
	return main(argv, getEnv("prod"));
}

export async function stagingMain(argv: string[]): Promise<void> {
	return main(argv, getEnv("staging"));
}
