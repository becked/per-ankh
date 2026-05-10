// Router for `./per-ankh admin <subcommand>`. Parses global flags (--json,
// --yes), dispatches to the right command module, prints errors and exits
// non-zero on failure.

import { err } from "./format";
import type { CommandOpts } from "./cli";

import * as stats from "./commands/stats";
import * as users from "./commands/users";
import * as games from "./commands/games";
import * as events from "./commands/events";
import * as shares from "./commands/shares";
import * as security from "./commands/security";

function printHelp(): void {
	process.stdout.write(
		[
			"per-ankh admin — cloud admin & monitoring CLI",
			"",
			"Usage:",
			"  ./per-ankh admin <command> [args] [--json] [--yes]",
			"",
			"Monitoring:",
			"  stats                            Global counts + recent activity",
			"  users [--limit N] [--sort K]     List users (sort: recent|uploads|created)",
			"  user <user_id>                   Show one user's detail",
			"  games [--limit N] [--user U]     List recent cloud games",
			"  game <game_id>                   Show one game's detail",
			"  events [--type T] [--user U] [--share S] [--limit N]   Audit log",
			"",
			"Legacy shares (frozen-but-served):",
			"  shares list [--limit N]          List legacy shares",
			"  shares info <share_id>           Show one share",
			"  shares delete <share_id>         Delete share (D1 + R2)",
			"  shares by-key <app_key>          List shares by app_key",
			"  shares keys                      App_keys grouped by share count",
			"",
			"Security:",
			"  block-key <key> [reason]         Block a legacy app_key",
			"  unblock-key <key>                Unblock",
			"  block-ip <ip> [reason]           Block an IP",
			"  unblock-ip <ip>                  Unblock",
			"  blocked                          List all blocked keys + IPs",
			"  nuke-key <key> [reason]          Block key + delete all its shares",
			"  nuke-user <user_id> [reason]     Delete user, their games, and R2 blobs",
			"",
			"Global flags:",
			"  --json                           Raw JSON output (skips tables)",
			"  --yes                            Skip confirmation prompts",
			"",
		].join("\n"),
	);
}

export async function main(argv: string[]): Promise<void> {
	// Strip global boolean flags from the argv; everything else is positional
	// or command-specific.
	const opts: CommandOpts = { json: false, yes: false };
	const rest: string[] = [];
	for (const a of argv) {
		if (a === "--json") opts.json = true;
		else if (a === "--yes") opts.yes = true;
		else rest.push(a);
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
		case "games":
			return games.runList(subArgs, opts);
		case "game":
			return games.runDetail(subArgs, opts);
		case "events":
			return events.run(subArgs, opts);
		case "shares":
			return shares.run(subArgs, opts);
		case "block-key":
			return security.runBlockKey(subArgs, opts);
		case "unblock-key":
			return security.runUnblockKey(subArgs, opts);
		case "block-ip":
			return security.runBlockIp(subArgs, opts);
		case "unblock-ip":
			return security.runUnblockIp(subArgs, opts);
		case "blocked":
			return security.runBlocked(subArgs, opts);
		case "nuke-key":
			return security.runNukeKey(subArgs, opts);
		case "nuke-user":
			return security.runNukeUser(subArgs, opts);
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
