// `./per-ankh admin games [--limit] [--user <id>]` — list recent cloud games.
// `./per-ankh admin game <id>` — full detail for one game.

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
} from "../format";
import {
	type CommandOpts,
	flagInt,
	flagString,
	parseFlags,
	printJson,
} from "../cli";

interface GameListRow {
	game_id: string;
	user_id: string;
	display_name: string | null;
	game_name: string | null;
	user_nation: string | null;
	total_turns: number;
	blob_size_bytes: number | null;
	created_at: string;
}

interface GameRow {
	game_id: string;
	user_id: string;
	xml_game_id: string;
	total_turns: number;
	file_hash: string;
	game_name: string | null;
	save_date: string | null;
	map_size: string | null;
	map_class: string | null;
	game_mode: string | null;
	difficulty: string | null;
	opponent_level: string | null;
	winner_nation: string | null;
	winner_name: string | null;
	victory_type: string | null;
	user_nation: string | null;
	user_won: number | null;
	is_public: number;
	blob_version: number;
	blob_size_bytes: number | null;
	parser_version: string;
	created_at: string;
	updated_at: string;
	collection_id: number | null;
}

interface OwnerRow {
	display_name: string;
	discord_id: string;
}

interface CountRow {
	cnt: number;
}

export async function runList(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { flags } = parseFlags(argv);
	const limit = flagInt(flags, "limit", 50);
	const userFilter = flagString(flags, "user");

	info(
		`Listing games${userFilter ? ` for user ${userFilter}` : ""} (limit ${limit})...`,
	);
	const where = userFilter ? `WHERE g.user_id = ${sqlStr(userFilter)}` : "";
	const sql = `
		SELECT g.game_id, g.user_id, u.display_name,
		       g.game_name, g.user_nation, g.total_turns,
		       g.blob_size_bytes, g.created_at
		FROM games g
		LEFT JOIN users u ON u.user_id = g.user_id
		${where}
		ORDER BY g.created_at DESC
		LIMIT ${limit}
	`;
	const rows = await d1Query<GameListRow>(sql);

	if (opts.json) {
		printJson(rows);
		return;
	}
	if (rows.length === 0) {
		process.stderr.write("No games found.\n");
		return;
	}

	const cols: Column[] = [
		{ header: "GAME_ID", width: 22 },
		{ header: "USER", width: 18 },
		{ header: "NAME", width: 22 },
		{ header: "NATION", width: 14 },
		{ header: "TURNS", width: 5, align: "right" },
		{ header: "SIZE", width: 8, align: "right" },
		{ header: "CREATED", width: 16 },
	];
	printTable(
		cols,
		rows.map((r) => [
			r.game_id,
			emdash(r.display_name),
			emdash(r.game_name),
			emdash(r.user_nation),
			String(r.total_turns),
			formatBytes(r.blob_size_bytes),
			formatDate(r.created_at),
		]),
	);
	printCount(rows.length, "games shown");
}

export async function runDetail(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const gameId = positional[0];
	if (!gameId) {
		throw new Error("Usage: ./per-ankh admin game <game_id>");
	}

	info(`Loading game ${gameId}...`);
	const idStr = sqlStr(gameId);
	const batch = await d1Batch([
		`SELECT * FROM games WHERE game_id = ${idStr}`,
		`SELECT u.display_name, u.discord_id FROM users u
		 JOIN games g ON g.user_id = u.user_id WHERE g.game_id = ${idStr}`,
		`SELECT COUNT(*) AS cnt FROM player_summaries WHERE game_id = ${idStr}`,
		`SELECT COUNT(*) AS cnt FROM game_player_turn WHERE game_id = ${idStr}`,
	]);
	const [gameRows, ownerRows, summaryCountRows, turnCountRows] = [
		batch[0] as GameRow[],
		batch[1] as OwnerRow[],
		batch[2] as CountRow[],
		batch[3] as CountRow[],
	];
	const game = gameRows[0];
	if (!game) {
		throw new Error(`Game not found: ${gameId}`);
	}
	const owner = ownerRows[0];

	if (opts.json) {
		printJson({
			game,
			owner,
			player_summary_count: summaryCountRows[0]?.cnt ?? 0,
			turn_row_count: turnCountRows[0]?.cnt ?? 0,
		});
		return;
	}

	printDetail("Game", [
		["Game ID", game.game_id],
		["Owner", `${emdash(owner?.display_name)} (${game.user_id})`],
		["Game name", emdash(game.game_name)],
		["XML game ID", game.xml_game_id],
		["Save date", formatDate(game.save_date)],
		["Turns", String(game.total_turns)],
		["Map", `${emdash(game.map_class)} / ${emdash(game.map_size)}`],
		["Mode", emdash(game.game_mode)],
		["Difficulty", emdash(game.difficulty)],
		["Opponent level", emdash(game.opponent_level)],
		["User nation", emdash(game.user_nation)],
		[
			"User won",
			game.user_won == null ? "—" : game.user_won ? "yes" : "no",
		],
		["Winner", emdash(game.winner_name ?? game.winner_nation)],
		["Victory type", emdash(game.victory_type)],
		["Is public", game.is_public ? "yes" : "no"],
		["Blob version", String(game.blob_version)],
		["Blob size", formatBytes(game.blob_size_bytes)],
		["Parser version", game.parser_version],
		["File hash", game.file_hash],
		["Player summaries", String(summaryCountRows[0]?.cnt ?? 0)],
		["Turn rows", String(turnCountRows[0]?.cnt ?? 0)],
		["Created", formatDate(game.created_at)],
		["Updated", formatDate(game.updated_at)],
		["R2 keys", `games/${game.game_id}.json.gz, saves/${game.game_id}.zip`],
	]);
}
