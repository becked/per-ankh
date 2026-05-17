// `./per-ankh admin tournament <subcommand>` — tournament metadata, admin
// role management, and (during the private beta) the beta allowlist.
//
// Tournament creation lives both here AND in the UI; UI creators become
// admins of their own tournaments automatically, so the CLI's `create`
// + `grant-admin` are for operator-bootstrapped tournaments and for adding
// a second admin to an existing tournament. Player slot management +
// lifecycle (start, transition-championship) lives in the web UI.
//
// Beta allowlist subcommands (`beta-grant|beta-revoke|beta-list`) are
// CLI-only; the API does not expose them. While the beta is on, every
// tournament endpoint 404s for callers whose discord_id isn't in
// tournament_beta_users.

import { randomBytes } from "node:crypto";

import { confirmTyping } from "../../lib/confirm";
import {
	type Column,
	emdash,
	formatDate,
	info,
	ok,
	printCount,
	printDetail,
	printTable,
} from "../../lib/format";
import {
	type CommandOpts,
	flagInt,
	flagString,
	parseFlags,
	printJson,
} from "../../lib/cli";
import { d1Exec, d1Query, sqlStr } from "../wrangler";
import { KNOWN_MAP_SCRIPTS } from "$lib/tournament/map-scripts";

// Nanoid-compatible 21-char ID generator (no external dep). Uses the
// standard nanoid alphabet so IDs are interchangeable with worker-issued
// ones (which use the `nanoid` npm package).
const NANOID_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
function nanoid21(): string {
	const bytes = randomBytes(21);
	let id = "";
	for (let i = 0; i < 21; i++) id += NANOID_ALPHABET[bytes[i] & 63];
	return id;
}

interface TournamentRow {
	tournament_id: string;
	slug: string;
	name: string;
	status: string;
	description: string | null;
	division_a_name: string;
	division_b_name: string;
	swiss_advance_count: number | null;
	swiss_wins_to_advance: number;
	swiss_losses_to_eliminate: number;
	swiss_max_rounds: number;
	allowed_map_scripts: string;
	created_at: string;
	updated_at: string;
}

interface AdminRow {
	user_id: string;
	display_name: string;
	discord_id: string;
	granted_at: string;
}

interface SlotCountRow {
	phase: string;
	count: number;
}

export async function run(argv: string[], opts: CommandOpts): Promise<void> {
	const sub = argv[0];
	const rest = argv.slice(1);
	switch (sub) {
		case "create":
			return runCreate(rest, opts);
		case "list":
			return runList(rest, opts);
		case "show":
			return runShow(rest, opts);
		case "grant-admin":
			return runGrantAdmin(rest, opts);
		case "revoke-admin":
			return runRevokeAdmin(rest, opts);
		case "delete":
			return runDelete(rest, opts);
		case "beta-grant":
			return runBetaGrant(rest, opts);
		case "beta-revoke":
			return runBetaRevoke(rest, opts);
		case "beta-list":
			return runBetaList(rest, opts);
		case undefined:
		case "--help":
		case "-h":
			printHelp();
			return;
		default:
			throw new Error(`Unknown tournament subcommand: ${sub}`);
	}
}

function printHelp(): void {
	process.stdout.write(
		[
			"./per-ankh admin tournament <subcommand>",
			"",
			"  create <slug> <name> --maps M1,M2,...",
			"                          Create a tournament (status='setup')",
			"                          Optional: --description, --div-a, --div-b",
			"  list [--status S]       List tournaments (filter: setup|swiss|championship|complete)",
			"  show <id-or-slug>       Show one tournament's detail",
			"  grant-admin <tournament_id> <user_id>",
			"                          Grant per-tournament admin to a user",
			"  revoke-admin <tournament_id> <user_id>",
			"                          Revoke per-tournament admin",
			"  delete <id>             Delete tournament + all slots/rounds/matches",
			"                          (Type 'delete' to confirm. Cascades.)",
			"",
			"Beta allowlist (private beta gate on every tournament endpoint):",
			"  beta-grant <id> [--note N]",
			"                          Add a user to the beta. <id> is either a",
			"                          user_id (nanoid21) or a raw Discord snowflake.",
			"                          Snowflakes can be pre-granted before signup;",
			"                          user_id is pinned at first login.",
			"  beta-revoke <id>        Remove a user from the beta. <id> can be",
			"                          either form. Effective immediately.",
			"  beta-list [--json]      Show the current beta allowlist.",
			"",
		].join("\n"),
	);
}

async function runCreate(argv: string[], opts: CommandOpts): Promise<void> {
	const { positional, flags } = parseFlags(argv);
	const slug = positional[0];
	const name = positional[1];
	if (!slug || !name) {
		throw new Error(
			"Usage: ./per-ankh admin tournament create <slug> <name> --maps M1,M2,...",
		);
	}
	if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
		throw new Error(
			`Slug must match /^[a-z0-9][a-z0-9-]{0,63}$/ — got "${slug}"`,
		);
	}
	const mapsRaw = flagString(flags, "maps");
	if (!mapsRaw) {
		throw new Error(
			"Must specify --maps with a comma-separated list of map_scripts",
		);
	}
	const maps = mapsRaw
		.split(",")
		.map((m) => m.trim())
		.filter((m) => m.length > 0);
	if (maps.length === 0) {
		throw new Error("--maps cannot be empty after parsing");
	}
	const validMapScripts = new Set(KNOWN_MAP_SCRIPTS.map((s) => s.value));
	const invalidMaps = maps.filter((m) => !validMapScripts.has(m));
	if (invalidMaps.length > 0) {
		throw new Error(
			`Unknown map_script value(s): ${invalidMaps.join(", ")}\n` +
				`Expected canonical MAPCLASS_MapScript<Name> identifiers — ` +
				`see KNOWN_MAP_SCRIPTS in src/lib/tournament/map-scripts.ts ` +
				`for the full list (e.g. MAPCLASS_MapScriptContinent, ` +
				`MAPCLASS_MapScriptAridPlateau, MAPCLASS_MapScriptInlandSea2).`,
		);
	}
	const description = flagString(flags, "description") ?? null;
	const divA = flagString(flags, "div-a") ?? "Division A";
	const divB = flagString(flags, "div-b") ?? "Division B";

	const tournamentId = nanoid21();
	await d1Exec(`
		INSERT INTO tournaments (
			tournament_id, slug, name, description, status,
			division_a_name, division_b_name, allowed_map_scripts
		) VALUES (
			${sqlStr(tournamentId)}, ${sqlStr(slug)}, ${sqlStr(name)},
			${description === null ? "NULL" : sqlStr(description)},
			'setup',
			${sqlStr(divA)}, ${sqlStr(divB)},
			${sqlStr(JSON.stringify(maps))}
		)
	`);

	if (opts.json) {
		printJson({
			tournament_id: tournamentId,
			slug,
			name,
			status: "setup",
			allowed_map_scripts: maps,
		});
	} else {
		ok(`Created tournament ${name} (id=${tournamentId}, slug=${slug})`);
		info(
			`Next: ./per-ankh admin tournament grant-admin ${tournamentId} <user_id>`,
		);
	}
}

async function runList(argv: string[], opts: CommandOpts): Promise<void> {
	const { flags } = parseFlags(argv);
	const limit = flagInt(flags, "limit", 50);
	const status = flagString(flags, "status");
	const allowedStatus = new Set(["setup", "swiss", "championship", "complete"]);
	if (status !== undefined && !allowedStatus.has(status)) {
		throw new Error(
			`unknown --status value: ${status} (expected one of: setup, swiss, championship, complete)`,
		);
	}
	const where = status ? `WHERE status = ${sqlStr(status)}` : "";
	const rows = await d1Query<{
		tournament_id: string;
		slug: string;
		name: string;
		status: string;
		swiss_advance_count: number | null;
		created_at: string;
	}>(`
		SELECT tournament_id, slug, name, status, swiss_advance_count, created_at
		FROM tournaments ${where}
		ORDER BY created_at DESC
		LIMIT ${limit}
	`);
	if (opts.json) {
		printJson(rows);
		return;
	}
	const cols: Column[] = [
		{ header: "tournament_id", width: 21 },
		{ header: "slug", width: 30 },
		{ header: "name", width: 28 },
		{ header: "status", width: 12 },
		{ header: "advance", width: 8, align: "right" },
		{ header: "created", width: 16 },
	];
	printTable(
		cols,
		rows.map((r) => [
			r.tournament_id,
			r.slug,
			r.name,
			r.status,
			r.swiss_advance_count !== null ? String(r.swiss_advance_count) : "—",
			formatDate(r.created_at),
		]),
	);
	printCount(rows.length, "tournaments");
}

async function runShow(argv: string[], opts: CommandOpts): Promise<void> {
	const { positional } = parseFlags(argv);
	const idOrSlug = positional[0];
	if (!idOrSlug) {
		throw new Error("Usage: ./per-ankh admin tournament show <id-or-slug>");
	}
	const isId = /^[A-Za-z0-9_-]{21}$/.test(idOrSlug);
	const tournament = (
		await d1Query<TournamentRow>(`
			SELECT * FROM tournaments
			WHERE ${isId ? "tournament_id" : "slug"} = ${sqlStr(idOrSlug)}
			LIMIT 1
		`)
	)[0];
	if (!tournament) {
		throw new Error(`Tournament not found: ${idOrSlug}`);
	}
	const admins = await d1Query<AdminRow>(`
		SELECT u.user_id, u.display_name, u.discord_id, a.granted_at
		FROM tournament_admins a
		JOIN users u ON u.user_id = a.user_id
		WHERE a.tournament_id = ${sqlStr(tournament.tournament_id)}
		ORDER BY a.granted_at
	`);
	const slotCounts = await d1Query<SlotCountRow>(`
		SELECT phase, COUNT(*) AS count FROM tournament_slots
		WHERE tournament_id = ${sqlStr(tournament.tournament_id)}
		GROUP BY phase
	`);
	const counts: Record<string, number> = {};
	for (const r of slotCounts) counts[r.phase] = r.count;
	if (opts.json) {
		printJson({
			tournament,
			admins,
			slot_counts: counts,
		});
		return;
	}
	let maps: string[] = [];
	try {
		const parsed = JSON.parse(tournament.allowed_map_scripts);
		if (Array.isArray(parsed)) maps = parsed.map(String);
	} catch {
		// fall through
	}
	printDetail(`Tournament: ${tournament.name}`, [
		["tournament_id", tournament.tournament_id],
		["slug", tournament.slug],
		["status", tournament.status],
		["description", emdash(tournament.description)],
		["division A", tournament.division_a_name],
		["division B", tournament.division_b_name],
		[
			"advance per division",
			tournament.swiss_advance_count !== null
				? String(tournament.swiss_advance_count)
				: "(unset)",
		],
		[
			"wins to advance / losses to eliminate / max rounds",
			`${tournament.swiss_wins_to_advance} / ${tournament.swiss_losses_to_eliminate} / ${tournament.swiss_max_rounds}`,
		],
		["allowed maps", maps.join(", ") || "—"],
		["slots (swiss)", String(counts["swiss"] ?? 0)],
		["slots (championship)", String(counts["championship"] ?? 0)],
		["created_at", formatDate(tournament.created_at)],
		["updated_at", formatDate(tournament.updated_at)],
	]);
	if (admins.length > 0) {
		const cols: Column[] = [
			{ header: "user_id", width: 21 },
			{ header: "display_name", width: 28 },
			{ header: "discord_id", width: 20 },
			{ header: "granted", width: 16 },
		];
		printTable(
			cols,
			admins.map((a) => [
				a.user_id,
				a.display_name,
				a.discord_id,
				formatDate(a.granted_at),
			]),
		);
		printCount(admins.length, "admins");
	} else {
		info("No tournament admins yet. Grant one with:");
		info(
			`  ./per-ankh admin tournament grant-admin ${tournament.tournament_id} <user_id>`,
		);
	}
}

async function runGrantAdmin(argv: string[], opts: CommandOpts): Promise<void> {
	const { positional } = parseFlags(argv);
	const tournamentId = positional[0];
	const userId = positional[1];
	if (!tournamentId || !userId) {
		throw new Error(
			"Usage: ./per-ankh admin tournament grant-admin <tournament_id> <user_id>",
		);
	}
	// Verify both exist before insert — D1 FK violations are noisy.
	const t = await d1Query<{ tournament_id: string }>(
		`SELECT tournament_id FROM tournaments WHERE tournament_id = ${sqlStr(tournamentId)}`,
	);
	if (t.length === 0) throw new Error(`Tournament not found: ${tournamentId}`);
	const u = await d1Query<{ user_id: string; display_name: string }>(
		`SELECT user_id, display_name FROM users WHERE user_id = ${sqlStr(userId)}`,
	);
	if (u.length === 0) throw new Error(`User not found: ${userId}`);

	await d1Exec(`
		INSERT INTO tournament_admins (tournament_id, user_id)
		VALUES (${sqlStr(tournamentId)}, ${sqlStr(userId)})
		ON CONFLICT (tournament_id, user_id) DO NOTHING
	`);
	if (opts.json) {
		printJson({
			tournament_id: tournamentId,
			user_id: userId,
			display_name: u[0].display_name,
			granted: true,
		});
	} else {
		ok(`Granted admin: ${u[0].display_name} (${userId}) → ${tournamentId}`);
	}
}

async function runRevokeAdmin(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const tournamentId = positional[0];
	const userId = positional[1];
	if (!tournamentId || !userId) {
		throw new Error(
			"Usage: ./per-ankh admin tournament revoke-admin <tournament_id> <user_id>",
		);
	}
	await d1Exec(`
		DELETE FROM tournament_admins
		WHERE tournament_id = ${sqlStr(tournamentId)} AND user_id = ${sqlStr(userId)}
	`);
	if (opts.json) {
		printJson({ tournament_id: tournamentId, user_id: userId, revoked: true });
	} else {
		ok(`Revoked admin: ${userId} from ${tournamentId}`);
	}
}

async function runDelete(argv: string[], opts: CommandOpts): Promise<void> {
	const { positional } = parseFlags(argv);
	const tournamentId = positional[0];
	if (!tournamentId) {
		throw new Error(
			"Usage: ./per-ankh admin tournament delete <tournament_id>",
		);
	}
	const t = await d1Query<TournamentRow>(
		`SELECT * FROM tournaments WHERE tournament_id = ${sqlStr(tournamentId)}`,
	);
	if (t.length === 0) {
		throw new Error(`Tournament not found: ${tournamentId}`);
	}
	const tournament = t[0];

	if (!opts.yes) {
		const confirmed = await confirmTyping(
			`This will delete tournament '${tournament.name}' (${tournament.status}) and ALL its slots, rounds, and matches. R2 game blobs are NOT deleted — only the tournament structure.`,
			"delete",
		);
		if (!confirmed) {
			info("Aborted.");
			return;
		}
	}

	// FK cascades handle slots, rounds, matches, admins.
	await d1Exec(
		`DELETE FROM tournaments WHERE tournament_id = ${sqlStr(tournamentId)}`,
	);
	if (opts.json) {
		printJson({
			tournament_id: tournamentId,
			name: tournament.name,
			deleted: true,
		});
	} else {
		ok(`Deleted tournament: ${tournament.name} (${tournamentId})`);
	}
}

// ---------------------------------------------------------------------------
// Beta allowlist
// ---------------------------------------------------------------------------

// Resolve either a user_id (nanoid21) or a raw Discord snowflake into
// { discord_id, user_id | null }. Errors with operator-actionable messages
// when the shape doesn't match or the user_id isn't in `users`. Discord
// IDs go through unverified — pre-signup grants are intentional.
interface ResolvedBetaTarget {
	discordId: string;
	userId: string | null;
	displayName: string | null;
}

async function resolveBetaTarget(arg: string): Promise<ResolvedBetaTarget> {
	// nanoid21: exactly 21 chars from [A-Za-z0-9_-]. Discord IDs are
	// numeric and currently 17-19 digits; we accept 15-20 to be generous
	// across snowflake epochs.
	const isNanoid21 = /^[A-Za-z0-9_-]{21}$/.test(arg);
	const isDiscordId = /^\d{15,20}$/.test(arg);
	if (isNanoid21) {
		const rows = await d1Query<{ user_id: string; discord_id: string; display_name: string }>(
			`SELECT user_id, discord_id, display_name FROM users
			 WHERE user_id = ${sqlStr(arg)}`,
		);
		if (rows.length === 0) {
			throw new Error(
				`User not found: ${arg}\n` +
					`If you meant a Discord ID, double-check — discord IDs are all-digits, ` +
					`typically 18-19 chars (turn on Discord Developer Mode → Copy User ID).`,
			);
		}
		return {
			discordId: rows[0].discord_id,
			userId: rows[0].user_id,
			displayName: rows[0].display_name,
		};
	}
	if (isDiscordId) {
		// Allow pre-grant for a user who hasn't signed in yet — the login-
		// time pin in handleDiscordCallback fills in user_id on first
		// signup. If the user already exists, attach their user_id now so
		// the request-time gate skips the unpinned scan.
		const rows = await d1Query<{ user_id: string; display_name: string }>(
			`SELECT user_id, display_name FROM users WHERE discord_id = ${sqlStr(arg)}`,
		);
		return {
			discordId: arg,
			userId: rows[0]?.user_id ?? null,
			displayName: rows[0]?.display_name ?? null,
		};
	}
	throw new Error(
		`Unrecognized ID shape: "${arg}"\n` +
			`Expected either a user_id (21 chars from the nanoid alphabet) or ` +
			`a Discord snowflake (15-20 digits). To find a Discord ID: ` +
			`turn on Developer Mode in Discord and right-click → Copy User ID, ` +
			`or run ./per-ankh admin users to list signed-up users.`,
	);
}

async function runBetaGrant(argv: string[], opts: CommandOpts): Promise<void> {
	const { positional, flags } = parseFlags(argv);
	const arg = positional[0];
	if (!arg) {
		throw new Error(
			"Usage: ./per-ankh admin tournament beta-grant <user_id|discord_id> [--note \"...\"]",
		);
	}
	const note = flagString(flags, "note") ?? null;
	const target = await resolveBetaTarget(arg);

	const result = await d1Query<{ changes: number }>(`
		INSERT INTO tournament_beta_users (discord_id, user_id, note)
		VALUES (
			${sqlStr(target.discordId)},
			${target.userId === null ? "NULL" : sqlStr(target.userId)},
			${note === null ? "NULL" : sqlStr(note)}
		)
		ON CONFLICT(discord_id) DO UPDATE SET
			user_id = COALESCE(excluded.user_id, tournament_beta_users.user_id),
			note = COALESCE(excluded.note, tournament_beta_users.note)
		RETURNING (CASE WHEN granted_at = datetime('now') THEN 1 ELSE 0 END) AS changes
	`);
	// RETURNING never empty since INSERT … ON CONFLICT always touches a row.
	const wasNew = (result[0]?.changes ?? 0) === 1;

	if (opts.json) {
		printJson({
			discord_id: target.discordId,
			user_id: target.userId,
			display_name: target.displayName,
			note,
			created: wasNew,
		});
		return;
	}
	const who = target.displayName
		? `${target.displayName} (discord ${target.discordId})`
		: `discord ${target.discordId}${target.userId ? ` / user ${target.userId}` : " (no signup yet)"}`;
	if (wasNew) {
		ok(`Granted beta access: ${who}${note ? ` — ${note}` : ""}`);
	} else {
		info(`Already in beta: ${who} (note + user_id refreshed if newly known)`);
	}
}

async function runBetaRevoke(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const arg = positional[0];
	if (!arg) {
		throw new Error(
			"Usage: ./per-ankh admin tournament beta-revoke <user_id|discord_id>",
		);
	}
	// Skip the users-table lookup for the revoke path — operators may want
	// to revoke a discord_id that was pre-granted and never signed up.
	// Either form lands the same DELETE.
	const isNanoid21 = /^[A-Za-z0-9_-]{21}$/.test(arg);
	const isDiscordId = /^\d{15,20}$/.test(arg);
	if (!isNanoid21 && !isDiscordId) {
		throw new Error(
			`Unrecognized ID shape: "${arg}" (expected user_id or discord_id)`,
		);
	}
	const result = await d1Query<{ discord_id: string }>(`
		DELETE FROM tournament_beta_users
		WHERE ${isNanoid21 ? "user_id" : "discord_id"} = ${sqlStr(arg)}
		RETURNING discord_id
	`);
	if (opts.json) {
		printJson({ revoked: result.length, discord_ids: result.map((r) => r.discord_id) });
	} else if (result.length === 0) {
		info(`No beta row matched ${arg} — nothing to revoke.`);
	} else {
		ok(`Revoked beta access (${result.length} row${result.length === 1 ? "" : "s"})`);
	}
}

async function runBetaList(argv: string[], opts: CommandOpts): Promise<void> {
	parseFlags(argv); // currently no flags beyond --json (read from opts)
	const rows = await d1Query<{
		discord_id: string;
		user_id: string | null;
		display_name: string | null;
		granted_at: string;
		note: string | null;
	}>(`
		SELECT b.discord_id, b.user_id, u.display_name, b.granted_at, b.note
		FROM tournament_beta_users b
		LEFT JOIN users u ON u.user_id = b.user_id
		ORDER BY b.granted_at
	`);
	if (opts.json) {
		printJson(rows);
		return;
	}
	if (rows.length === 0) {
		info("No beta users granted yet.");
		info("Grant with: ./per-ankh admin tournament beta-grant <user_id|discord_id>");
		return;
	}
	const cols: Column[] = [
		{ header: "discord_id", width: 20 },
		{ header: "user_id", width: 21 },
		{ header: "display_name", width: 24 },
		{ header: "granted", width: 16 },
		{ header: "note", width: 30 },
	];
	printTable(
		cols,
		rows.map((r) => [
			r.discord_id,
			r.user_id ?? "—",
			r.display_name ?? "(not signed in yet)",
			formatDate(r.granted_at),
			r.note ?? "—",
		]),
	);
	printCount(rows.length, "beta users");
}
