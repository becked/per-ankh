// `./per-ankh admin tournament <subcommand>` — tournament metadata + admin
// role management. Tournament creation lives here (not in the API) so the
// only path to inserting tournament_admins is operator-driven. Player slot
// management + lifecycle (start, transition-championship) lives in the
// tournament admin web UI; the CLI handles only the bootstrapping bits.

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
