// `./per-ankh admin users` — list users (recent login first by default).
// `./per-ankh admin user <id>` — full detail for one user.

import { d1Batch, d1Query, sqlStr } from "../wrangler";
import {
	type Column,
	emdash,
	formatBytes,
	formatDate,
	info,
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
	]);
	const [
		userRows,
		collectionRows,
		onlineIdRows,
		gameRows,
		eventRows,
		gameCountRows,
	] = [
		batch[0] as UserRow[],
		batch[1] as CollectionRow[],
		batch[2] as OnlineIdRow[],
		batch[3] as RecentGameRow[],
		batch[4] as RecentEventRow[],
		batch[5] as { cnt: number }[],
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
			recent_games: gameRows,
			recent_events: eventRows,
		});
		return;
	}

	printDetail("User", [
		["User ID", user.user_id],
		["Display name", emdash(user.display_name)],
		["Discord ID", user.discord_id],
		["Email", emdash(user.email)],
		["Email verified", user.email_verified ? "yes" : "no"],
		["Created", formatDate(user.created_at)],
		["Last login", formatDate(user.last_login_at)],
		["Games", String(totalGames)],
		["Collections", String(collectionRows.length)],
		["Online IDs", String(onlineIdRows.length)],
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
