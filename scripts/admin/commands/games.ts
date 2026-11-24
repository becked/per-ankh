// `./per-ankh admin games [--limit] [--user <id>]` — list recent cloud games.
// `./per-ankh admin game <id>` — full detail for one game.

import { purgeUrls, screenshotUrlsFor } from "../purge";
import {
	d1Batch,
	d1Exec,
	d1Query,
	r2DeleteMany,
	screenshotBucketName,
	sqlStr,
} from "../wrangler";
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
	flagString,
	parseFlags,
	printJson,
} from "../../lib/cli";
import { confirmTyping } from "../../lib/confirm";
import { clearUserStatsBundles } from "./cache";

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

interface WinnerSeatRow {
	player_name: string;
	nation: string | null;
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
		`SELECT COUNT(*) AS cnt FROM game_screenshots WHERE game_id = ${idStr}`,
		`SELECT player_name, nation FROM player_summaries
		 WHERE game_id = ${idStr} AND is_winner = 1 ORDER BY player_index`,
	]);
	const [
		gameRows,
		ownerRows,
		summaryCountRows,
		turnCountRows,
		shotCountRows,
		winnerSeatRows,
	] = [
		batch[0] as GameRow[],
		batch[1] as OwnerRow[],
		batch[2] as CountRow[],
		batch[3] as CountRow[],
		batch[4] as CountRow[],
		batch[5] as WinnerSeatRow[],
	];
	const game = gameRows[0];
	if (!game) {
		throw new Error(`Game not found: ${gameId}`);
	}
	const owner = ownerRows[0];

	const screenshotCount = shotCountRows[0]?.cnt ?? 0;

	// A team win has more than one winning seat, and `games.winner_name` /
	// `winner_nation` name only the lowest of them (#384). Name each seat the
	// way the single-winner form does: leader name, else nation.
	const winner =
		winnerSeatRows.length > 1
			? winnerSeatRows.map((r) => r.player_name || emdash(r.nation)).join(" + ")
			: emdash(game.winner_name ?? game.winner_nation);

	if (opts.json) {
		printJson({
			game,
			owner,
			player_summary_count: summaryCountRows[0]?.cnt ?? 0,
			turn_row_count: turnCountRows[0]?.cnt ?? 0,
			screenshot_count: screenshotCount,
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
		// Old World's own names for the two columns: `difficulty` is the
		// PROSPERITY tier and `opponent_level` is AI Aggression. Raw zTypes
		// rather than display names, as everywhere else on this page.
		["Prosperity", emdash(game.difficulty)],
		["AI Aggression", emdash(game.opponent_level)],
		["User nation", emdash(game.user_nation)],
		["User won", game.user_won == null ? "—" : game.user_won ? "yes" : "no"],
		["Winner", winner],
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
		// A game's screenshots live in their own bucket under one prefix, and
		// each one has two cached URLs. Named here because `delete-game` has
		// to clear all of it and this is the page an operator reads first.
		["Screenshots", `${screenshotCount} under screenshots/${game.game_id}/`],
	]);
}

// ─── shared delete helper ──────────────────────────────────────────────────
//
// Deletes the given games and their R2 blobs (parsed blob + raw save ZIP),
// plus any screenshots they have — a second bucket, and public, so those also
// need purging from the edge. The D1 cascade handles player_summaries,
// game_player_turn, tech_events, law_events, and game_screenshots. Callers own
// the confirmation prompt, the audit-event row, and the final summary line.
// Shared by `delete-game`, `purge-games`, and `nuke-user`.
//
// The screenshot keys are read from D1 rather than listed from the bucket —
// the Worker's own path lists by prefix, which also catches an object whose
// insert failed, but wrangler has no object-list command for the CLI to use.
// Every screenshot a reader could ever have reached has a row, so the gap is
// an object no URL was ever built for. Read BEFORE the DELETE below, which
// cascades those rows away.
export async function deleteGames(gameIds: string[]): Promise<void> {
	if (gameIds.length === 0) return;

	const keys: string[] = [];
	for (const id of gameIds) {
		keys.push(`games/${id}.json.gz`);
		keys.push(`saves/${id}.zip`);
	}
	info(`Deleting ${keys.length} R2 object(s)...`);
	const r2Summary = await r2DeleteMany(keys);
	info(
		`R2: ok=${r2Summary.ok} missing=${r2Summary.missing} failed=${r2Summary.failed}`,
	);
	for (const err of r2Summary.errors.slice(0, 5)) warn(err);

	const idList = gameIds.map(sqlStr).join(", ");
	const shotRows = await d1Query<{ r2_key: string }>(
		`SELECT r2_key FROM game_screenshots WHERE game_id IN (${idList})`,
	);
	if (shotRows.length > 0) {
		const shotKeys = shotRows.map((r) => r.r2_key);
		info(`Deleting ${shotKeys.length} screenshot object(s)...`);
		const shotSummary = await r2DeleteMany(
			shotKeys,
			10,
			screenshotBucketName(),
		);
		info(
			`Screenshots: ok=${shotSummary.ok} missing=${shotSummary.missing} failed=${shotSummary.failed}`,
		);
		for (const err of shotSummary.errors.slice(0, 5)) warn(err);
		// Deleting the object is not enough: it is public, edge-cached, and has
		// no Worker in its read path to re-evaluate anything.
		await purgeUrls(screenshotUrlsFor(shotKeys));
	}

	info(`Deleting ${gameIds.length} game(s) from D1...`);
	await d1Exec(`DELETE FROM games WHERE game_id IN (${idList})`);
}

// ─── delete-game (single game; account untouched) ──────────────────────────

export async function runDelete(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const gameId = positional[0];
	if (!gameId) {
		throw new Error("Usage: ./per-ankh admin delete-game <game_id>");
	}

	const rows = await d1Query<{
		game_id: string;
		user_id: string;
		game_name: string | null;
		total_turns: number;
		display_name: string | null;
		screenshots: number;
	}>(`
		SELECT g.game_id, g.user_id, g.game_name, g.total_turns, u.display_name,
		       (SELECT COUNT(*) FROM game_screenshots s
		         WHERE s.game_id = g.game_id) AS screenshots
		FROM games g LEFT JOIN users u ON u.user_id = g.user_id
		WHERE g.game_id = ${sqlStr(gameId)}
	`);
	const game = rows[0];
	if (!game) {
		throw new Error(`Game not found: ${gameId}`);
	}
	const screenshotCount = game.screenshots;

	if (!opts.yes) {
		const yes = await confirmTyping(
			`DELETE GAME: ${emdash(game.game_name)} (${game.game_id})\n` +
				`  Owner: ${emdash(game.display_name)} (${game.user_id})\n` +
				`  Turns: ${game.total_turns}\n` +
				`  Screenshots: ${screenshotCount}\n` +
				`  Deletes the game row (+ cascades), R2 blobs, and any screenshots\n` +
				`  (objects + edge cache). The account stays.`,
			"delete",
		);
		if (!yes) {
			info("Cancelled.");
			return;
		}
	}

	await deleteGames([game.game_id]);

	const metadata = JSON.stringify({ game_name: game.game_name });
	await d1Exec(`
		INSERT INTO events (event_type, user_id, game_id, metadata)
		VALUES ('delete_game', ${sqlStr(game.user_id)}, ${sqlStr(game.game_id)}, ${sqlStr(metadata)})
	`);

	ok(`Deleted game ${game.game_id}.`);
}

// ─── purge-games (all of one user's games; account untouched) ──────────────

export async function runPurge(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { flags } = parseFlags(argv);
	const userId = flagString(flags, "user");
	if (!userId) {
		throw new Error("Usage: ./per-ankh admin purge-games --user <user_id>");
	}

	const userRows = await d1Query<{
		user_id: string;
		display_name: string | null;
	}>(
		`SELECT user_id, display_name FROM users WHERE user_id = ${sqlStr(userId)}`,
	);
	const user = userRows[0];
	if (!user) {
		throw new Error(`User not found: ${userId}`);
	}

	const gameRows = await d1Query<{ game_id: string }>(
		`SELECT game_id FROM games WHERE user_id = ${sqlStr(userId)}`,
	);
	const gameIds = gameRows.map((r) => r.game_id);
	if (gameIds.length === 0) {
		info("User has no games.");
		return;
	}

	if (!opts.yes) {
		const yes = await confirmTyping(
			`PURGE GAMES: ${emdash(user.display_name)} (${userId})\n` +
				`  Delete ${gameIds.length} game(s) + their R2 blobs (json.gz + zip)\n` +
				`  + any screenshots (objects + edge cache).\n` +
				`  The account, collections, and online_ids stay.`,
			"purge",
		);
		if (!yes) {
			info("Cancelled.");
			return;
		}
	}

	await deleteGames(gameIds);

	const metadata = JSON.stringify({
		display_name: user.display_name,
		games_deleted: gameIds.length,
	});
	await d1Exec(`
		INSERT INTO events (event_type, user_id, metadata)
		VALUES ('purge_games', ${sqlStr(userId)}, ${sqlStr(metadata)})
	`);

	ok(
		`Purged ${gameIds.length} game(s) from ${emdash(user.display_name)} (${userId}).`,
	);
}

// ─── set-uploader (which seat the owner claimed) ──────────────────────────
//
// `./per-ankh admin set-uploader <game_id> <player_index | observer>`
//
// The operator half of `PATCH /v1/games/:id { uploader_player_index }`, which
// the owner drives from the game page's player popover
// (src/lib/GameActions.svelte) and which is owner-only with no admin override
// — a 403 for anyone else (cloud/src/games.ts). That leaves the cross-account
// repairs reachable from nowhere: `online-ids unlink` removes the link, and
// the claim that re-creates it on the next reparse belongs to a different
// account than the one the bad link harms.
//
// Why a claim has to move at all: `reparse-all` posts the stored seat back
// verbatim (reparse.ts) and `handleGameUpload` re-runs `captureOnlineIds` on
// that seat's id, so unlinking alone lasts until the next parser bump.
//
// Three guards carry over from handleGamePatch because they are rules about
// the data, not about who is asking: a tournament-linked save is locked (the
// match's slot mapping is the historical record of which player the uploader
// was), a run on an open challenge is locked (the verdict is scored once and
// never rescored), and the index must name a human seat in this game. The
// per-user rate limit does not carry over — it is an abuse guard on a public
// endpoint.
//
// The pick is validated against `player_summaries` rather than the R2 blob the
// Worker reads. The table is that blob's pivot, rebuilt from it by every
// reparse and reindex, and the two columns this writes derive identically:
// across the 798 claimed games in the 2026-11-15 local snapshot, the seat's
// `nation` and `is_winner` reproduce the stored `games.user_nation` and
// `user_won` on every row, NULL for the 26 games no seat won included.

interface SeatRow {
	player_index: number;
	player_name: string;
	nation: string | null;
	is_human: number;
	is_uploader: number;
	is_winner: number;
}

interface SetUploaderGameRow {
	game_id: string;
	user_id: string;
	owner_name: string | null;
	game_name: string | null;
	display_name: string | null;
	user_nation: string | null;
	user_won: number | null;
	tournament_linked: number;
	open_challenge_run: number;
	winner_seats: number;
}

export async function runSetUploader(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const gameId = positional[0];
	const seatArg = positional[1];
	const usage =
		"Usage: ./per-ankh admin set-uploader <game_id> <player_index | observer>";
	if (!gameId || seatArg === undefined) throw new Error(usage);

	// `observer` rather than a bare `null`, so the argument reads as the thing
	// the owner's own picker calls it ("I didn't play in this game") and a
	// typo can't be mistaken for a seat.
	let nextIndex: number | null;
	if (seatArg === "observer") {
		nextIndex = null;
	} else {
		const parsed = Number(seatArg);
		if (!Number.isInteger(parsed) || parsed < 0) {
			throw new Error(
				`${usage}\n\nSeat must be a non-negative integer or 'observer'.`,
			);
		}
		nextIndex = parsed;
	}

	const idStr = sqlStr(gameId);
	const [gameRaw, seatRaw] = await d1Batch([
		`SELECT g.game_id, g.user_id, COALESCE(u.alias, u.display_name) AS owner_name,
		        g.game_name, g.display_name, g.user_nation, g.user_won,
		        (SELECT COUNT(*) FROM tournament_matches tm WHERE tm.game_id = g.game_id) AS tournament_linked,
		        (SELECT COUNT(*) FROM challenge_submissions s
		           JOIN challenges c ON c.challenge_id = s.challenge_id
		          WHERE s.game_id = g.game_id AND c.closes_at > datetime('now')) AS open_challenge_run,
		        (SELECT COUNT(*) FROM player_summaries w
		          WHERE w.game_id = g.game_id AND w.is_winner = 1) AS winner_seats
		   FROM games g
		   LEFT JOIN users u ON u.user_id = g.user_id
		  WHERE g.game_id = ${idStr}`,
		`SELECT player_index, player_name, nation, is_human, is_uploader, is_winner
		   FROM player_summaries WHERE game_id = ${idStr} ORDER BY player_index`,
	]);
	const game = (gameRaw as SetUploaderGameRow[])[0];
	if (!game) throw new Error(`Game not found: ${gameId}`);
	const seats = seatRaw as SeatRow[];

	if (game.tournament_linked > 0) {
		throw new Error(
			"Game is linked to a tournament match; the slot mapping is the record of which player the uploader was.",
		);
	}
	if (game.open_challenge_run > 0) {
		throw new Error(
			"Game is a run on an open challenge; its verdict is scored once and never rescored.",
		);
	}

	const next =
		nextIndex === null ? null : seats.find((s) => s.player_index === nextIndex);
	if (nextIndex !== null && (!next || !next.is_human)) {
		throw new Error(
			`Player index ${nextIndex} not found among humans. Human seats: ${
				seats
					.filter((s) => s.is_human)
					.map((s) => `${s.player_index} (${s.player_name || "unnamed"})`)
					.join(", ") || "none"
			}`,
		);
	}

	const current = seats.find((s) => s.is_uploader === 1) ?? null;
	if ((current?.player_index ?? null) === nextIndex) {
		info(
			nextIndex === null
				? "Already an observer upload. Nothing to change."
				: `Seat ${nextIndex} is already the claimed seat. Nothing to change.`,
		);
		return;
	}

	// Mirrors deriveUploaderColumns (cloud/src/games.ts): observer clears both,
	// and user_won stays NULL on a save that records no winner at all, which is
	// distinct from "played and lost".
	const nextNation = next?.nation ?? null;
	const nextWon =
		next == null ? null : game.winner_seats === 0 ? null : next.is_winner;

	const label = (s: SeatRow | null): string =>
		s === null
			? "observer (no claim)"
			: `seat ${s.player_index} ${s.player_name || "unnamed"}`;

	if (!opts.json) {
		printDetail("Change claimed seat", [
			[
				"Game",
				`${emdash(game.display_name ?? game.game_name)} (${game.game_id})`,
			],
			["Owner", `${emdash(game.owner_name)} (${game.user_id})`],
			["From", label(current)],
			["To", label(next ?? null)],
			["user_nation", `${emdash(game.user_nation)} -> ${emdash(nextNation)}`],
			[
				"user_won",
				`${game.user_won == null ? "—" : game.user_won ? "yes" : "no"} -> ${
					nextWon == null ? "—" : nextWon ? "yes" : "no"
				}`,
			],
		]);
		printTable(
			[
				{ header: "SEAT", width: 4, align: "right" },
				{ header: "NAME", width: 20 },
				{ header: "NATION", width: 20 },
				{ header: "HUMAN", width: 5 },
				{ header: "CLAIMED", width: 7 },
			],
			seats.map((s) => [
				String(s.player_index),
				s.player_name || emdash(null),
				emdash(s.nation),
				s.is_human ? "yes" : "no",
				s.is_uploader ? "yes" : "no",
			]),
		);
		process.stdout.write("\n");
	}

	if (!opts.yes) {
		const yes = await confirmTyping(
			`Change ${emdash(game.owner_name)}'s claimed seat on this game?`,
			"set-uploader",
		);
		if (!yes) {
			info("Cancelled.");
			return;
		}
	}

	// Clear, then set — two statements rather than one CASE, the same reason
	// handleGamePatch gives: migration 0053's partial unique index is checked
	// as each row is written, so a single UPDATE moving the flag to a lower
	// player_index would set the new row before clearing the old one and trip
	// the index mid-statement.
	await d1Batch([
		`UPDATE player_summaries SET is_uploader = 0 WHERE game_id = ${idStr}`,
		...(nextIndex === null
			? []
			: [
					`UPDATE player_summaries SET is_uploader = 1
					  WHERE game_id = ${idStr} AND player_index = ${nextIndex}`,
				]),
		`UPDATE games SET user_nation = ${nextNation === null ? "NULL" : sqlStr(nextNation)},
		        user_won = ${nextWon == null ? "NULL" : nextWon ? 1 : 0},
		        updated_at = datetime('now')
		  WHERE game_id = ${idStr}`,
	]);

	const metadata = JSON.stringify({
		game_id: gameId,
		from_player_index: current?.player_index ?? null,
		from_player_name: current?.player_name ?? null,
		to_player_index: nextIndex,
		to_player_name: next?.player_name ?? null,
		user_nation: nextNation,
	});
	await d1Exec(`
		INSERT INTO events (event_type, game_id, user_id, metadata)
		VALUES ('set_uploader', ${idStr}, ${sqlStr(game.user_id)}, ${sqlStr(metadata)})
	`);

	// The Worker invalidates the owner's bundles on the same change; this write
	// bypasses it, so the clear happens here or the owner's charts keep
	// describing the old seat for the cache's full TTL.
	const cleared = await clearUserStatsBundles(game.user_id);

	if (opts.json) {
		printJson({
			game_id: gameId,
			user_id: game.user_id,
			from_player_index: current?.player_index ?? null,
			to_player_index: nextIndex,
			user_nation: nextNation,
			user_won: nextWon,
			stats_bundles_cleared: cleared,
		});
		return;
	}
	ok(
		`Claimed seat on ${gameId} is now ${label(next ?? null)}; ${cleared} stats bundle(s) cleared.`,
	);
	// Duel ratings read is_uploader and rebuild nightly (cloud/src/ratings/
	// rebuild.ts), so they keep the old attribution until 03:47 or an admin
	// trigger. Said rather than done: there is no CLI surface for that rebuild.
	info(
		"Duel ratings follow on the next nightly rebuild (or POST /v1/admin/ratings/rebuild).",
	);
}
