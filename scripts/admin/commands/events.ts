// `./per-ankh admin events [--type T] [--user U] [--share S] [--limit N]`
// Recent audit-log entries from the shared `events` table (covers both legacy
// share events and cloud-rewrite events — they coexist in one table).

import { d1Query, sqlStr } from "../wrangler";
import {
	type Column,
	emdash,
	formatDate,
	info,
	printCount,
	printTable,
} from "../../lib/format";
import {
	type CommandOpts,
	flagInt,
	flagString,
	parseFlags,
	printJson,
} from "../../lib/cli";

interface EventRow {
	id: number;
	event_type: string;
	share_id: string | null;
	app_key: string | null;
	game_id: string | null;
	user_id: string | null;
	ip_address: string | null;
	created_at: string;
}

export async function run(argv: string[], opts: CommandOpts): Promise<void> {
	const { flags } = parseFlags(argv);
	const limit = flagInt(flags, "limit", 50);
	const typeFilter = flagString(flags, "type");
	const userFilter = flagString(flags, "user");
	const shareFilter = flagString(flags, "share");

	const where: string[] = [];
	if (typeFilter) where.push(`event_type = ${sqlStr(typeFilter)}`);
	if (userFilter) where.push(`user_id = ${sqlStr(userFilter)}`);
	if (shareFilter) where.push(`share_id = ${sqlStr(shareFilter)}`);
	const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

	info(`Listing events (limit ${limit})...`);
	const sql = `
		SELECT id, event_type, share_id, app_key, game_id, user_id, ip_address, created_at
		FROM events
		${whereSql}
		ORDER BY created_at DESC
		LIMIT ${limit}
	`;
	const rows = await d1Query<EventRow>(sql);

	if (opts.json) {
		printJson(rows);
		return;
	}
	if (rows.length === 0) {
		process.stderr.write("No events found.\n");
		return;
	}

	const cols: Column[] = [
		{ header: "TYPE", width: 18 },
		{ header: "GAME/SHARE", width: 22 },
		{ header: "USER/KEY", width: 22 },
		{ header: "IP", width: 16 },
		{ header: "TIME", width: 16 },
	];
	printTable(
		cols,
		rows.map((r) => [
			r.event_type,
			emdash(r.game_id ?? r.share_id),
			emdash(r.user_id ?? r.app_key),
			emdash(r.ip_address),
			formatDate(r.created_at),
		]),
	);
	printCount(rows.length, "events shown");
}
