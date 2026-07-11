// `./per-ankh admin users` — list users (recent login first by default).
// `./per-ankh admin user <id>` — full detail for one user.
// `./per-ankh admin find-user <query>` — search users by handle / display name
//   / email, with their tournament-slot involvement.

import { d1Batch, d1Exec, d1Query, sqlStr } from "../wrangler";
import {
	bold,
	type Column,
	dim,
	emdash,
	formatBytes,
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

interface UserListRow {
	user_id: string;
	display_name: string;
	discord_id: string;
	email: string | null;
	created_at: string;
	last_login_at: string;
	game_count: number;
	last_upload: string | null;
}

interface UserRow {
	user_id: string;
	display_name: string;
	alias: string | null;
	discord_id: string;
	avatar_hash: string | null;
	email: string | null;
	email_verified: number | null;
	created_at: string;
	last_login_at: string;
}

interface CollectionRow {
	collection_id: number;
	name: string;
	is_default: number;
}

interface OnlineIdRow {
	online_id: string;
	first_seen_at: string;
	last_seen_at: string;
}

interface ChannelDetailRow {
	platform: string;
	channel_url: string;
	channel_id: string;
	updated_at: string;
}

interface RecentGameRow {
	game_id: string;
	game_name: string | null;
	user_nation: string | null;
	total_turns: number;
	blob_size_bytes: number | null;
	created_at: string;
}

interface RecentEventRow {
	event_type: string;
	game_id: string | null;
	share_id: string | null;
	ip_address: string | null;
	created_at: string;
}

interface UserMatchRow {
	user_id: string;
	discord_username: string | null;
	display_name: string;
	alias: string | null;
	discord_id: string;
	email: string | null;
	created_at: string;
	last_login_at: string;
	game_count: number;
}

interface SlotMatchRow {
	slot_id: string;
	tournament_id: string;
	slug: string;
	tournament_name: string;
	tournament_status: string;
	phase: string;
	division: string | null;
	swiss_seed: number | null;
	championship_seed: number | null;
	discord_username: string | null;
	discord_id: string | null;
	user_id: string | null;
}

const SORT_CLAUSES: Record<string, string> = {
	recent: "u.last_login_at DESC",
	uploads: "game_count DESC, u.last_login_at DESC",
	created: "u.created_at DESC",
};

export async function runList(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { flags } = parseFlags(argv);
	const limit = flagInt(flags, "limit", 50);
	const sortKey = flagString(flags, "sort") ?? "recent";
	const orderBy = SORT_CLAUSES[sortKey];
	if (!orderBy) {
		throw new Error(
			`unknown --sort value: ${sortKey} (expected one of: recent, uploads, created)`,
		);
	}

	info(`Listing users (sort=${sortKey}, limit=${limit})...`);
	const sql = `
		SELECT
		  u.user_id, u.display_name, u.discord_id, u.email,
		  u.created_at, u.last_login_at,
		  (SELECT COUNT(*)  FROM games g WHERE g.user_id = u.user_id) AS game_count,
		  (SELECT MAX(created_at) FROM games g WHERE g.user_id = u.user_id) AS last_upload
		FROM users u
		ORDER BY ${orderBy}
		LIMIT ${limit}
	`;
	const rows = await d1Query<UserListRow>(sql);

	if (opts.json) {
		printJson(rows);
		return;
	}
	if (rows.length === 0) {
		process.stderr.write("No users found.\n");
		return;
	}

	const cols: Column[] = [
		{ header: "USER_ID", width: 22 },
		{ header: "NAME", width: 22 },
		{ header: "GAMES", width: 5, align: "right" },
		{ header: "LAST UPLOAD", width: 16 },
		{ header: "LAST LOGIN", width: 16 },
		{ header: "CREATED", width: 16 },
	];
	printTable(
		cols,
		rows.map((r) => [
			r.user_id,
			emdash(r.display_name),
			String(r.game_count),
			formatDate(r.last_upload),
			formatDate(r.last_login_at),
			formatDate(r.created_at),
		]),
	);
	printCount(rows.length, "users shown");
}

export async function runDetail(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const userId = positional[0];
	if (!userId) {
		throw new Error("Usage: ./per-ankh admin user <user_id>");
	}

	info(`Loading user ${userId}...`);
	const idStr = sqlStr(userId);
	const batch = await d1Batch([
		`SELECT * FROM users WHERE user_id = ${idStr}`,
		`SELECT collection_id, name, is_default FROM collections WHERE user_id = ${idStr} ORDER BY collection_id`,
		`SELECT online_id, first_seen_at, last_seen_at FROM user_online_ids
		 WHERE user_id = ${idStr} ORDER BY last_seen_at DESC`,
		`SELECT game_id, game_name, user_nation, total_turns, blob_size_bytes, created_at
		 FROM games WHERE user_id = ${idStr} ORDER BY created_at DESC LIMIT 10`,
		`SELECT event_type, game_id, share_id, ip_address, created_at
		 FROM events WHERE user_id = ${idStr} ORDER BY created_at DESC LIMIT 10`,
		`SELECT COUNT(*) AS cnt FROM games WHERE user_id = ${idStr}`,
		`SELECT platform, channel_url, channel_id, updated_at FROM user_video_channels
		 WHERE user_id = ${idStr} ORDER BY platform`,
	]);
	const [
		userRows,
		collectionRows,
		onlineIdRows,
		gameRows,
		eventRows,
		gameCountRows,
		channelRows,
	] = [
		batch[0] as UserRow[],
		batch[1] as CollectionRow[],
		batch[2] as OnlineIdRow[],
		batch[3] as RecentGameRow[],
		batch[4] as RecentEventRow[],
		batch[5] as { cnt: number }[],
		batch[6] as ChannelDetailRow[],
	];
	const totalGames = gameCountRows[0]?.cnt ?? 0;
	const user = userRows[0];
	if (!user) {
		throw new Error(`User not found: ${userId}`);
	}

	if (opts.json) {
		printJson({
			user,
			collections: collectionRows,
			online_ids: onlineIdRows,
			channels: channelRows,
			recent_games: gameRows,
			recent_events: eventRows,
		});
		return;
	}

	printDetail("User", [
		["User ID", user.user_id],
		["Display name", emdash(user.display_name)],
		["Alias", emdash(user.alias)],
		["Discord ID", user.discord_id],
		["Email", emdash(user.email)],
		["Email verified", user.email_verified ? "yes" : "no"],
		["Created", formatDate(user.created_at)],
		["Last login", formatDate(user.last_login_at)],
		["Games", String(totalGames)],
		["Collections", String(collectionRows.length)],
		["Online IDs", String(onlineIdRows.length)],
		["Channels", String(channelRows.length)],
	]);

	if (collectionRows.length > 0) {
		printTable(
			[
				{ header: "COLLECTION_ID", width: 13, align: "right" },
				{ header: "NAME", width: 24 },
				{ header: "DEFAULT", width: 7 },
			],
			collectionRows.map((c) => [
				String(c.collection_id),
				c.name,
				c.is_default ? "yes" : "no",
			]),
		);
		process.stdout.write("\n");
	}

	if (onlineIdRows.length > 0) {
		printTable(
			[
				{ header: "ONLINE_ID", width: 24 },
				{ header: "FIRST SEEN", width: 16 },
				{ header: "LAST SEEN", width: 16 },
			],
			onlineIdRows.map((o) => [
				o.online_id,
				formatDate(o.first_seen_at),
				formatDate(o.last_seen_at),
			]),
		);
		process.stdout.write("\n");
	}

	if (channelRows.length > 0) {
		printTable(
			[
				{ header: "PLATFORM", width: 8 },
				{ header: "CHANNEL_ID", width: 26 },
				{ header: "CHANNEL_URL", width: 34 },
				{ header: "UPDATED", width: 16 },
			],
			channelRows.map((c) => [
				c.platform,
				c.channel_id,
				c.channel_url,
				formatDate(c.updated_at),
			]),
		);
		process.stdout.write("\n");
	}

	if (gameRows.length > 0) {
		printTable(
			[
				{ header: "GAME_ID", width: 22 },
				{ header: "NAME", width: 22 },
				{ header: "NATION", width: 16 },
				{ header: "TURNS", width: 5, align: "right" },
				{ header: "SIZE", width: 8, align: "right" },
				{ header: "CREATED", width: 16 },
			],
			gameRows.map((g) => [
				g.game_id,
				emdash(g.game_name),
				emdash(g.user_nation),
				String(g.total_turns),
				formatBytes(g.blob_size_bytes),
				formatDate(g.created_at),
			]),
		);
		process.stdout.write("\n");
	}

	if (eventRows.length > 0) {
		printTable(
			[
				{ header: "TYPE", width: 18 },
				{ header: "GAME/SHARE", width: 22 },
				{ header: "IP", width: 16 },
				{ header: "TIME", width: 16 },
			],
			eventRows.map((e) => [
				e.event_type,
				emdash(e.game_id ?? e.share_id),
				emdash(e.ip_address),
				formatDate(e.created_at),
			]),
		);
	}
}

export async function runFind(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional, flags } = parseFlags(argv);
	const query = positional[0];
	if (!query) {
		throw new Error(
			"Usage: ./per-ankh admin find-user <query>  (matches discord handle, display name, or email)",
		);
	}
	const limit = flagInt(flags, "limit", 25);

	info(`Searching users matching "${query}"...`);

	// Case-insensitive substring match. discord_username is stored lowercase
	// (auth.ts), display_name/email are mixed-case, so we lower() both sides.
	// Any `%` / `_` in the query stay live wildcards — useful for operators.
	const like = sqlStr(`%${query.toLowerCase()}%`);
	const userPredicate =
		`lower(u.discord_username) LIKE ${like} ` +
		`OR lower(u.display_name) LIKE ${like} ` +
		`OR lower(u.alias) LIKE ${like} ` +
		`OR lower(u.email) LIKE ${like}`;

	const batch = await d1Batch([
		`SELECT
		   u.user_id, u.discord_username, u.display_name, u.alias, u.discord_id, u.email,
		   u.created_at, u.last_login_at,
		   (SELECT COUNT(*) FROM games g WHERE g.user_id = u.user_id) AS game_count
		 FROM users u
		 WHERE ${userPredicate}
		 ORDER BY u.last_login_at DESC
		 LIMIT ${limit}`,
		// Slots matched by handle text catch admin-prefilled, still-unclaimed
		// slots that have no users row yet; the user_id IN (...) arm also
		// catches slots claimed by a user we matched on display name or email.
		`SELECT
		   s.slot_id, s.tournament_id, t.slug, t.name AS tournament_name,
		   t.status AS tournament_status, s.phase, s.division,
		   s.swiss_seed, s.championship_seed,
		   s.discord_username, s.discord_id, s.user_id
		 FROM tournament_slots s
		 JOIN tournaments t ON t.tournament_id = s.tournament_id
		 WHERE lower(s.discord_username) LIKE ${like}
		    OR s.user_id IN (SELECT u.user_id FROM users u WHERE ${userPredicate})
		 ORDER BY t.slug, s.phase, s.division, s.swiss_seed
		 LIMIT ${limit}`,
	]);
	const users = batch[0] as UserMatchRow[];
	const slots = batch[1] as SlotMatchRow[];

	if (opts.json) {
		printJson({ users, slots });
		return;
	}

	if (users.length === 0 && slots.length === 0) {
		process.stderr.write(`No users or slots match "${query}".\n`);
		return;
	}

	if (users.length > 0) {
		process.stdout.write(`\n${bold("Matching users")}\n`);
		printTable(
			[
				{ header: "USER_ID", width: 22 },
				{ header: "HANDLE", width: 20 },
				{ header: "NAME", width: 18 },
				{ header: "ALIAS", width: 16 },
				{ header: "EMAIL", width: 26 },
				{ header: "GAMES", width: 5, align: "right" },
				{ header: "LAST LOGIN", width: 16 },
			],
			users.map((u) => [
				u.user_id,
				emdash(u.discord_username),
				emdash(u.display_name),
				emdash(u.alias),
				emdash(u.email),
				String(u.game_count),
				formatDate(u.last_login_at),
			]),
		);
		printCount(users.length, "users matched");
	} else {
		process.stdout.write(`\n${dim("No matching user accounts.")}\n`);
	}

	if (slots.length > 0) {
		process.stdout.write(`\n${bold("Tournament slots")}\n`);
		printTable(
			[
				{ header: "SLOT_ID", width: 22 },
				{ header: "TOURNAMENT", width: 24 },
				{ header: "STATUS", width: 12 },
				{ header: "PHASE", width: 12 },
				{ header: "DIV", width: 3 },
				{ header: "SEED", width: 5, align: "right" },
				{ header: "HANDLE", width: 16 },
				{ header: "CLAIMED", width: 7 },
			],
			slots.map((s) => [
				s.slot_id,
				emdash(s.slug),
				s.tournament_status,
				s.phase,
				emdash(s.division),
				s.swiss_seed != null
					? String(s.swiss_seed)
					: s.championship_seed != null
						? String(s.championship_seed)
						: "—",
				emdash(s.discord_username),
				s.user_id ? "yes" : "no",
			]),
		);
		printCount(slots.length, "slots matched");
	}
}

// Cap matches the migration's intent (a display label, not free text) and
// keeps the alias from blowing out table layouts wherever it's rendered.
const MAX_ALIAS_LEN = 64;

interface AliasUserRow {
	user_id: string;
	display_name: string;
	alias: string | null;
}

// `./per-ankh admin set-alias <user_id> <alias>` — set an operator display
// alias that overrides the Discord display_name everywhere the app renders
// this account (resolved server-side via COALESCE; see cloud/src/identity.ts).
export async function runSetAlias(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const userId = positional[0];
	const rawAlias = positional[1];
	if (!userId || rawAlias === undefined) {
		throw new Error("Usage: ./per-ankh admin set-alias <user_id> <alias>");
	}
	const alias = rawAlias.trim();
	if (alias.length === 0) {
		throw new Error("Alias is empty (use clear-alias to remove an alias).");
	}
	if (alias.length > MAX_ALIAS_LEN) {
		throw new Error(
			`Alias too long (${alias.length} > ${MAX_ALIAS_LEN} chars).`,
		);
	}
	for (const ch of alias) {
		const code = ch.charCodeAt(0);
		if (code < 0x20 || code === 0x7f) {
			throw new Error("Alias contains control characters.");
		}
	}

	const rows = await d1Query<AliasUserRow>(
		`SELECT user_id, display_name, alias FROM users WHERE user_id = ${sqlStr(userId)}`,
	);
	const user = rows[0];
	if (!user) {
		throw new Error(`User not found: ${userId}`);
	}

	await d1Exec(
		`UPDATE users SET alias = ${sqlStr(alias)} WHERE user_id = ${sqlStr(userId)}`,
	);

	if (opts.json) {
		printJson({
			user_id: userId,
			display_name: user.display_name,
			alias,
			previous_alias: user.alias,
		});
		return;
	}
	ok(
		`Alias set: ${user.display_name} (${userId}) → "${alias}"` +
			(user.alias ? ` (was "${user.alias}")` : ""),
	);
}

// `./per-ankh admin clear-alias <user_id>` — drop the operator alias, reverting
// the account to its Discord display_name everywhere.
export async function runClearAlias(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const userId = positional[0];
	if (!userId) {
		throw new Error("Usage: ./per-ankh admin clear-alias <user_id>");
	}

	const rows = await d1Query<AliasUserRow>(
		`SELECT user_id, display_name, alias FROM users WHERE user_id = ${sqlStr(userId)}`,
	);
	const user = rows[0];
	if (!user) {
		throw new Error(`User not found: ${userId}`);
	}
	if (user.alias === null) {
		info(`User ${user.display_name} (${userId}) has no alias set.`);
		return;
	}

	await d1Exec(
		`UPDATE users SET alias = NULL WHERE user_id = ${sqlStr(userId)}`,
	);

	if (opts.json) {
		printJson({
			user_id: userId,
			display_name: user.display_name,
			alias: null,
			previous_alias: user.alias,
		});
		return;
	}
	ok(`Alias cleared: ${user.display_name} (${userId}) (was "${user.alias}")`);
}
