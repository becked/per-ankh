// Router for `./per-ankh admin <subcommand>`. Parses global flags (--json,
// --yes), dispatches to the right command module, prints errors and exits
// non-zero on failure.

import { err, info } from "../lib/format";
import type { CommandOpts } from "../lib/cli";
import { setTarget } from "./wrangler";

import * as stats from "./commands/stats";
import * as users from "./commands/users";
import * as channels from "./commands/channels";
import * as games from "./commands/games";
import * as events from "./commands/events";
import * as security from "./commands/security";
import * as tournament from "./commands/tournament";
import * as cache from "./commands/cache";
import * as duelEventTitles from "./commands/duel-event-titles";
import * as reparse from "./commands/reparse";
import * as devLogin from "./commands/dev-login";

function printHelp(): void {
	process.stdout.write(
		[
			"per-ankh admin — cloud admin & monitoring CLI",
			"",
			"Usage:",
			"  ./per-ankh admin <command> [args] [--json] [--yes] [--local | --staging]",
			"",
			"Monitoring:",
			"  stats                            Global counts + recent activity",
			"  users [--limit N] [--sort K]     List users (sort: recent|uploads|created)",
			"  user <user_id>                   Show one user's detail",
			"  find-user <query> [--limit N]    Find users by handle / name / slug / email (+ slots)",
			"  set-alias <user_id> <alias>      Set an operator display alias (overrides name)",
			"  clear-alias <user_id>            Remove a user's display alias",
			"  set-slug <user_id> <slug>        Set a user's profile URL (per-ankh.app/u/<slug>)",
			"  clear-slug <user_id>             Remove it, freeing the name for anyone to claim",
			"  backfill-slugs [--dry-run]       Derive profile URLs for users who have none",
			"  games [--limit N] [--user U]     List recent cloud games",
			"  game <game_id>                   Show one game's detail",
			"  delete-game <game_id>            Delete one game (D1 + R2); account stays",
			"  purge-games --user <user_id>     Delete all of a user's games; account stays",
			"  events [--type T] [--user U] [--limit N]               Audit log",
			"",
			"Creator video channels:",
			"  add-channel <user_id> <url|@handle>   Link a user's YouTube channel (resolves + upserts)",
			"  remove-channel <user_id> <platform>   Unlink a user's channel for a platform",
			"  list-channels [--limit N]             List all linked creator channels",
			"",
			"Corpus sweeps (one wrangler spawn per matching save, hundreds of them):",
			"  reparse-all [--dry-run] [--user U] [--limit N] [--from-version V]",
			"              [--concurrency N] [--cache-dir DIR]",
			"                                   Rewrite every game whose stored parser_version",
			"                                   isn't the current one: parse locally, then re-upload",
			"                                   through the Worker, which replaces its blob and",
			"                                   derived rows in place (screenshots, collections and",
			"                                   tournament links survive). The target is always this",
			"                                   checkout's PARSER_VERSION; --from-version V narrows",
			"                                   the sweep to the games stored at exactly V. Needs",
			"                                   ADMIN_CLI_TOKEN exported (--dry-run doesn't).",
			"  duel-event-titles [--csv] [--out FILE] [--concurrency N] [--cache-dir DIR]",
			"                                   Event stories that have fired in a two-player",
			"                                   multiplayer duel, with per-event counts",
			"",
			"Security:",
			"  nuke-user <user_id> [reason]     Delete user, their games, and R2 blobs",
			"",
			"Tournaments:",
			"  tournament create <slug> <name> --maps M1,M2,...",
			"                                   Create a tournament (status='setup')",
			"  tournament seed <slug> [name] --local [--qualifiers N] [--fill STAGE]",
			"                                   Seed a complete local fixture (Swiss + bracket)",
			"  tournament list [--status S]     List tournaments",
			"  tournament show <id-or-slug>     Show one tournament's detail",
			"  tournament grant-admin <t_id> <u_id>   Grant per-tournament admin",
			"  tournament revoke-admin <t_id> <u_id>  Revoke per-tournament admin",
			"  tournament delete <t_id>         Delete tournament (cascades to slots/rounds/matches)",
			"",
			"Caches (KV):",
			"  cache list [--kind K] [--match S] [--limit N]",
			"                                   Show cached stats bundles / video feeds",
			"  cache clear <stats|videos|all> [--match S]",
			"                                   Delete cached entries (never session:/oauth:)",
			"",
			"Dev (local only):",
			"  dev-login [--username NAME]      Provision a fake local user + session.",
			"                                   Requires --local; refuses against remote.",
			"",
			"Global flags:",
			"  --json                           Raw JSON output (skips tables)",
			"  --yes                            Skip confirmation prompts",
			"  --local                          Target local .wrangler state",
			"  --staging                        Target staging D1 + R2 (remote)",
			"                                   (default: remote production)",
			"",
		].join("\n"),
	);
}

export async function main(argv: string[]): Promise<void> {
	// Strip global boolean flags from the argv; everything else is positional
	// or command-specific.
	const opts: CommandOpts = { json: false, yes: false };
	let local = false;
	let staging = false;
	const rest: string[] = [];
	for (const a of argv) {
		if (a === "--json") opts.json = true;
		else if (a === "--yes") opts.yes = true;
		else if (a === "--local") local = true;
		else if (a === "--staging") staging = true;
		else rest.push(a);
	}
	if (local && staging) {
		err("--local and --staging are mutually exclusive.");
		process.exit(1);
	}
	setTarget(local ? "local" : staging ? "staging" : "prod");
	if (local && !opts.json) {
		info(
			"Targeting local .wrangler state (D1 + R2). Drop --local to hit production.",
		);
	}
	if (staging && !opts.json) {
		info(
			"Targeting staging (D1 + R2, remote). Drop --staging to hit production.",
		);
	}

	const sub = rest[0];
	const subArgs = rest.slice(1);

	switch (sub) {
		case "stats":
			return stats.run(subArgs, opts);
		case "users":
			return users.runList(subArgs, opts);
		case "user":
			return users.runDetail(subArgs, opts);
		case "find-user":
			return users.runFind(subArgs, opts);
		case "set-alias":
			return users.runSetAlias(subArgs, opts);
		case "clear-alias":
			return users.runClearAlias(subArgs, opts);
		case "set-slug":
			return users.runSetSlug(subArgs, opts);
		case "clear-slug":
			return users.runClearSlug(subArgs, opts);
		case "backfill-slugs":
			return users.runBackfillSlugs(subArgs, opts);
		case "add-channel":
			return channels.runAddChannel(subArgs, opts);
		case "remove-channel":
			return channels.runRemoveChannel(subArgs, opts);
		case "list-channels":
			return channels.runListChannels(subArgs, opts);
		case "games":
			return games.runList(subArgs, opts);
		case "game":
			return games.runDetail(subArgs, opts);
		case "delete-game":
			return games.runDelete(subArgs, opts);
		case "purge-games":
			return games.runPurge(subArgs, opts);
		case "events":
			return events.run(subArgs, opts);
		case "reparse-all":
			return reparse.run(subArgs, opts);
		case "duel-event-titles":
			return duelEventTitles.run(subArgs, opts);
		case "nuke-user":
			return security.runNukeUser(subArgs, opts);
		case "tournament":
			return tournament.run(subArgs, opts);
		case "cache":
			return cache.run(subArgs, opts);
		case "dev-login":
			return devLogin.run(subArgs, opts);
		case undefined:
		case "help":
		case "--help":
		case "-h":
			printHelp();
			return;
		default:
			err(`Unknown admin subcommand: ${sub}`);
			process.stderr.write("\n");
			printHelp();
			process.exit(1);
	}
}
