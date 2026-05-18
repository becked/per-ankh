// `./per-ankh admin --local dev-login [--username NAME]`
//
// Provisions a fake user in local D1 + KV so an operator can act as a
// "second account" against the dev stack without owning a second Discord
// account. The flow mirrors what handleDiscordCallback does in production,
// minus the OAuth round-trip:
//   1. INSERT into users     (display_name = the chosen username)
//   2. INSERT into tournament_beta_users (so the tournament gate doesn't 404)
//   3. PUT session:<token>   into SESSIONS_KV with a 30-day TTL
// The output is a `session=<token>` cookie value. Operators paste it into an
// incognito/private browser window (DevTools → Application → Cookies) and
// they're "signed in" as that user.
//
// Hard-gated on --local. Anyone running this against remote would land a
// fake row in the prod users table — bad on every axis, blocked here.

import { randomBytes } from "node:crypto";
import type { CommandOpts } from "../../lib/cli";
import { info } from "../../lib/format";
import { d1Exec, isLocal, kvPutSession, sqlStr } from "../wrangler";

// nanoid alphabet; matches scripts/admin/commands/tournament.ts.
const NANOID_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

function nanoid(length: number): string {
	const bytes = randomBytes(length);
	let id = "";
	for (let i = 0; i < length; i++) id += NANOID_ALPHABET[bytes[i] & 63];
	return id;
}

// Snowflake-shaped fake Discord ID. Real snowflakes are 64-bit ints rendered
// as decimal; we just need a unique-ish 18-digit string that doesn't collide
// with real callers. Prefix with `9` so the value is obviously out-of-band
// (Discord snowflakes from this era start with 7 or 8).
function fakeDiscordId(): string {
	const tail = randomBytes(8)
		.toString("hex")
		.replace(/[a-f]/g, "")
		.slice(0, 17)
		.padEnd(17, "0");
	return "9" + tail;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // matches cloud/src/session.ts

export async function run(argv: string[], _opts: CommandOpts): Promise<void> {
	if (!isLocal()) {
		throw new Error(
			"dev-login refuses to run without --local. Pass --local explicitly: " +
				"`./per-ankh admin --local dev-login`. This command writes fake user " +
				"rows; running against remote would pollute production.",
		);
	}

	// Tiny inline flag parser — the global parser already stripped --json /
	// --yes / --local before we got here. Only --username remains.
	let username: string | null = null;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--username") {
			username = argv[i + 1] ?? null;
			i++;
		} else if (a === "--help" || a === "-h") {
			printHelp();
			return;
		} else {
			throw new Error(`Unknown argument: ${a}`);
		}
	}
	if (username === null) {
		// Generate something obvious so the slot listings clearly mark these
		// rows as dev fixtures (vs. accidentally looking like real users).
		username = `dev-${nanoid(8).toLowerCase()}`;
	}
	// Discord-username conventions: lowercase, [a-z0-9._] only.
	const normalized = username.toLowerCase().replace(/[^a-z0-9._]/g, "-");
	if (normalized.length === 0 || normalized.length > 32) {
		throw new Error(
			`Invalid --username "${username}" — after lowercasing/sanitizing it must be 1–32 chars of [a-z0-9._].`,
		);
	}

	const userId = nanoid(21);
	const discordId = fakeDiscordId();
	const sessionToken = nanoid(32);

	// 1) Create user. ON CONFLICT(discord_id) is a non-issue here since
	// discord_id is freshly generated. display_name doubles as a readable
	// label in admin output. discord_username mirrors handleDiscordCallback's
	// lowercased handle so the user is findable via /v1/users/search and can
	// be pre-linked into tournament slots.
	await d1Exec(
		`INSERT INTO users (user_id, discord_id, display_name, discord_username)
		 VALUES (${sqlStr(userId)}, ${sqlStr(discordId)}, ${sqlStr(normalized)}, ${sqlStr(normalized)})`,
	);

	// 2) Beta-allowlist the user so tournament endpoints don't 404.
	await d1Exec(
		`INSERT INTO tournament_beta_users (discord_id, user_id, note)
		 VALUES (${sqlStr(discordId)}, ${sqlStr(userId)}, 'dev-login fixture')`,
	);

	// 3) Mint a session in KV. The handler-side validator (readSession in
	// cloud/src/session.ts) requires both user_id and discord_username to be
	// strings — anything less is treated as "no session".
	const sessionPayload = JSON.stringify({
		user_id: userId,
		discord_username: normalized,
	});
	await kvPutSession(
		`session:${sessionToken}`,
		sessionPayload,
		SESSION_TTL_SECONDS,
	);

	info(`Created local dev user`);
	info(`  user_id          ${userId}`);
	info(`  discord_id       ${discordId} (fake)`);
	info(`  discord_username ${normalized}`);
	info("");
	info("Cookie value:");
	process.stdout.write(`session=${sessionToken}\n`);
	info("");
	info("To use:");
	info("  1. Open http://localhost:1420 in an incognito / private window");
	info("     (so it doesn't clobber your real session in the main profile).");
	info("  2. DevTools → Application → Cookies → http://localhost:1420 →");
	info(`     add: name=session  value=${sessionToken}  domain=localhost`);
	info("  3. Reload. You're signed in as the fake user.");
}

function printHelp(): void {
	process.stdout.write(
		[
			"per-ankh admin dev-login — provision a fake local user for testing",
			"",
			"Usage:",
			"  ./per-ankh admin --local dev-login [--username NAME]",
			"",
			"Creates a fake user in local D1, beta-grants them, and mints a 30-day",
			"session in local KV. Prints the cookie value to paste into an incognito",
			"browser window's DevTools.",
			"",
			"Options:",
			"  --username NAME    Lowercased Discord-handle-shaped string (1-32 chars,",
			"                     [a-z0-9._] after sanitizing). Defaults to dev-<random>.",
			"",
			"Requires --local. Refuses to run against remote (would pollute prod).",
			"",
		].join("\n"),
	);
}
