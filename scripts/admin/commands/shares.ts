// `./per-ankh admin shares <subcommand>` — legacy share index management.
// Ports cloud/admin.sh's list/info/delete/by-key/keys commands. These operate
// on the frozen-but-still-served legacy world (shares table + R2 keys at
// `{share_id}.json.gz`), not on the new cloud-rewrite games table.

import { d1Exec, d1Query, r2Delete, sqlStr } from "../wrangler";
import { confirmYesNo } from "../../lib/confirm";
import {
	type Column,
	emdash,
	formatBytes,
	formatDate,
	info,
	ok,
	printCount,
	printDetail,
	printTable,
	warn,
} from "../../lib/format";
import {
	type CommandOpts,
	flagInt,
	parseFlags,
	printJson,
} from "../../lib/cli";

interface ShareListRow {
	share_id: string;
	game_name: string | null;
	player_nation: string | null;
	total_turns: number | null;
	map_size: string | null;
	blob_size_bytes: number | null;
	created_at: string;
}

interface ShareDetailRow extends ShareListRow {
	app_key: string;
	blob_version: number;
}

interface KeysRow {
	app_key: string;
	share_count: number;
	last_upload: string;
}

export async function run(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const sub = argv[0];
	const rest = argv.slice(1);
	switch (sub) {
		case "list":
			return runList(rest, opts);
		case "info":
			return runInfo(rest, opts);
		case "delete":
			return runDelete(rest, opts);
		case "by-key":
			return runByKey(rest, opts);
		case "keys":
			return runKeys(rest, opts);
		case undefined:
		case "--help":
		case "-h":
			printHelp();
			return;
		default:
			throw new Error(`Unknown shares subcommand: ${sub}`);
	}
}

function printHelp(): void {
	process.stdout.write(
		[
			"./per-ankh admin shares <subcommand>",
			"",
			"  list [--limit N]    List recent legacy shares",
			"  info <share_id>     Show details for one share",
			"  delete <share_id>   Delete share (D1 + R2)",
			"  by-key <app_key>    List shares from one app_key",
			"  keys                List app_keys grouped by share count",
			"",
		].join("\n"),
	);
}

async function runList(argv: string[], opts: CommandOpts): Promise<void> {
	const { flags } = parseFlags(argv);
	const limit = flagInt(flags, "limit", 50);

	info(`Listing shares (limit ${limit})...`);
	const rows = await d1Query<ShareListRow>(`
		SELECT share_id, game_name, player_nation, total_turns,
		       map_size, blob_size_bytes, created_at
		FROM shares
		ORDER BY created_at DESC
		LIMIT ${limit}
	`);

	if (opts.json) {
		printJson(rows);
		return;
	}
	if (rows.length === 0) {
		warn("No shares found.");
		return;
	}

	const cols: Column[] = [
		{ header: "SHARE_ID", width: 22 },
		{ header: "GAME", width: 25 },
		{ header: "NATION", width: 18 },
		{ header: "TURNS", width: 5, align: "right" },
		{ header: "MAP", width: 10 },
		{ header: "SIZE", width: 8, align: "right" },
		{ header: "CREATED", width: 16 },
	];
	printTable(
		cols,
		rows.map((r) => [
			r.share_id,
			emdash(r.game_name),
			emdash(r.player_nation),
			String(r.total_turns ?? 0),
			emdash(r.map_size),
			formatBytes(r.blob_size_bytes),
			formatDate(r.created_at),
		]),
	);
	printCount(rows.length, "shares shown");
}

async function runInfo(argv: string[], opts: CommandOpts): Promise<void> {
	const { positional } = parseFlags(argv);
	const shareId = positional[0];
	if (!shareId) {
		throw new Error("Usage: ./per-ankh admin shares info <share_id>");
	}

	const rows = await d1Query<ShareDetailRow>(`
		SELECT share_id, app_key, created_at, blob_version,
		       game_name, total_turns, player_nation, map_size, blob_size_bytes
		FROM shares WHERE share_id = ${sqlStr(shareId)}
	`);
	const r = rows[0];
	if (!r) {
		throw new Error(`Share not found: ${shareId}`);
	}

	if (opts.json) {
		printJson(r);
		return;
	}

	printDetail("Share", [
		["Share ID", r.share_id],
		["App key", r.app_key],
		["Created", formatDate(r.created_at)],
		["Blob version", String(r.blob_version)],
		["Game name", emdash(r.game_name)],
		["Turns", String(r.total_turns ?? 0)],
		["Nation", emdash(r.player_nation)],
		["Map size", emdash(r.map_size)],
		["Blob size", formatBytes(r.blob_size_bytes)],
		["URL", `https://per-ankh.app/share/${r.share_id}`],
		["R2 key", `${r.share_id}.json.gz`],
	]);
}

async function runDelete(argv: string[], opts: CommandOpts): Promise<void> {
	const { positional } = parseFlags(argv);
	const shareId = positional[0];
	if (!shareId) {
		throw new Error("Usage: ./per-ankh admin shares delete <share_id>");
	}

	const rows = await d1Query<{ share_id: string; game_name: string | null }>(
		`SELECT share_id, game_name FROM shares WHERE share_id = ${sqlStr(shareId)}`,
	);
	const found = rows[0];
	if (!found) {
		throw new Error(`Share not found: ${shareId}`);
	}

	if (!opts.yes) {
		const name = found.game_name ?? "unnamed";
		const yes = await confirmYesNo(
			`About to delete share ${shareId} (${name}). Are you sure?`,
		);
		if (!yes) {
			info("Cancelled.");
			return;
		}
	}

	info("Deleting from R2...");
	try {
		await r2Delete(`${shareId}.json.gz`);
	} catch (e) {
		warn(`R2 blob delete failed (may already be gone): ${String(e)}`);
	}

	info("Deleting from D1...");
	await d1Exec(`DELETE FROM shares WHERE share_id = ${sqlStr(shareId)}`);
	ok(`Share ${shareId} deleted.`);
}

async function runByKey(argv: string[], opts: CommandOpts): Promise<void> {
	const { positional } = parseFlags(argv);
	const key = positional[0];
	if (!key) {
		throw new Error("Usage: ./per-ankh admin shares by-key <app_key>");
	}

	info(`Shares for key: ${key}`);
	const rows = await d1Query<ShareListRow>(`
		SELECT share_id, game_name, player_nation, total_turns,
		       NULL AS map_size, blob_size_bytes, created_at
		FROM shares WHERE app_key = ${sqlStr(key)}
		ORDER BY created_at DESC
	`);

	if (opts.json) {
		printJson(rows);
		return;
	}
	if (rows.length === 0) {
		warn("No shares found for this key.");
		return;
	}

	printTable(
		[
			{ header: "SHARE_ID", width: 22 },
			{ header: "GAME", width: 25 },
			{ header: "NATION", width: 18 },
			{ header: "TURNS", width: 5, align: "right" },
			{ header: "SIZE", width: 8, align: "right" },
			{ header: "CREATED", width: 16 },
		],
		rows.map((r) => [
			r.share_id,
			emdash(r.game_name),
			emdash(r.player_nation),
			String(r.total_turns ?? 0),
			formatBytes(r.blob_size_bytes),
			formatDate(r.created_at),
		]),
	);
	printCount(rows.length, "shares");
}

async function runKeys(_argv: string[], opts: CommandOpts): Promise<void> {
	info("Listing app keys...");
	const rows = await d1Query<KeysRow>(`
		SELECT app_key, COUNT(*) AS share_count, MAX(created_at) AS last_upload
		FROM shares
		GROUP BY app_key
		ORDER BY share_count DESC
	`);

	if (opts.json) {
		printJson(rows);
		return;
	}
	if (rows.length === 0) {
		warn("No app keys found.");
		return;
	}

	printTable(
		[
			{ header: "APP_KEY", width: 38 },
			{ header: "SHARES", width: 6, align: "right" },
			{ header: "LAST UPLOAD", width: 16 },
		],
		rows.map((r) => [
			r.app_key,
			String(r.share_count),
			formatDate(r.last_upload),
		]),
	);
	printCount(rows.length, "unique keys");
}
