// What a re-import has to carry across the games row's INSERT OR REPLACE.
//
// `game_screenshots.game_id` is ON DELETE CASCADE on `games`, and
// `screenshot_reports.screenshot_id` is ON DELETE CASCADE on that — so the
// REPLACE, which resolves the primary-key conflict by deleting the old row,
// takes both tables with it, the second through the first. Every other child
// of a re-imported game is either rebuilt from the fresh blob in the same
// batch (player_summaries and its siblings) or captured and restored like this
// (tournament_matches.game_id, challenge_submissions).
//
// Nothing can rebuild these two. A screenshot row indexes bytes in R2 that the
// re-import never touches — the key is `screenshots/{game_id}/…` and the
// game_id is stable across a re-import, so the objects stay exactly where the
// restored rows say they are. Its Clef probabilities are what the classifier
// said about those bytes when they were stored and are never recomputed
// (migration 0050). And a report, or a takedown, or a star is a record of
// something a person did.
//
// So the rows go back verbatim, every column: a re-import is a newer parse of
// the same save, and it says nothing about the pictures of it, who starred
// one, or who reported one. The capture-and-reinsert shape is
// challenge_submissions' (challenges/link.ts) and so is the reason it lives
// inside handleGameUpload's batch — the restore has to be atomic with the
// REPLACE that made it necessary.
//
// A module of its own rather than part of handlers.ts for the reason scope.ts
// gives: games.ts is the caller, and handlers.ts imports games.ts.

import type { QueryableD1 } from "../d1";

// One stored screenshot, whole. The insert below writes every column, so a
// column added to the table has to be added here too or a re-import would
// silently drop it back to its default.
export interface GameScreenshotRow {
	screenshot_id: string;
	game_id: string;
	user_id: string;
	r2_key: string;
	width: number;
	height: number;
	size_bytes: number;
	caption: string | null;
	is_old_world: number;
	contains_nsfw: number;
	contains_gore: number;
	is_a_photograph: number;
	game_screenshot_confidence: number;
	game_screenshot_probabilities: string;
	featured_at: string | null;
	featured_by: string | null;
	hidden_at: string | null;
	hidden_by: string | null;
	created_at: string;
}

// One report against one of them, resolved or open.
export interface ScreenshotReportRow {
	screenshot_id: string;
	reporter_user_id: string;
	reason: string;
	created_at: string;
	resolved_at: string | null;
	resolved_by: string | null;
}

// Both tables together, because they are lost together and have to be put back
// in this order — a report's FK target is its screenshot.
export interface GameScreenshotState {
	screenshots: GameScreenshotRow[];
	reports: ScreenshotReportRow[];
}

export async function loadScreenshotsForGame(
	db: QueryableD1,
	gameId: string,
): Promise<GameScreenshotState> {
	const screenshots =
		(
			await db
				.prepare(
					`SELECT screenshot_id, game_id, user_id, r2_key, width, height,
					        size_bytes, caption, is_old_world, contains_nsfw,
					        contains_gore, is_a_photograph,
					        game_screenshot_confidence,
					        game_screenshot_probabilities, featured_at, featured_by,
					        hidden_at, hidden_by, created_at
					 FROM game_screenshots WHERE game_id = ?`,
				)
				.bind(gameId)
				.all<GameScreenshotRow>()
		).results ?? [];
	// No rows, no reports — a game with no screenshots is the common
	// re-import, and this is the read it doesn't spend.
	if (screenshots.length === 0) return { screenshots, reports: [] };

	// Joined rather than an IN over the ids above: one bound parameter instead
	// of a list whose length varies with the game.
	const reports =
		(
			await db
				.prepare(
					`SELECT r.screenshot_id, r.reporter_user_id, r.reason,
					        r.created_at, r.resolved_at, r.resolved_by
					 FROM screenshot_reports r
					 JOIN game_screenshots s ON s.screenshot_id = r.screenshot_id
					 WHERE s.game_id = ?`,
				)
				.bind(gameId)
				.all<ScreenshotReportRow>()
		).results ?? [];
	return { screenshots, reports };
}

// Plain inserts, not upserts: the cascade has already emptied both tables of
// these rows inside the same batch, so there is nothing to conflict with.
// created_at is bound rather than defaulted — the column's DEFAULT would stamp
// the re-import's clock onto a picture uploaded months earlier, and both
// galleries order on it.
export const gameScreenshotInsert = {
	sql: `INSERT INTO game_screenshots
	        (screenshot_id, game_id, user_id, r2_key, width, height, size_bytes,
	         caption, is_old_world, contains_nsfw, contains_gore,
	         is_a_photograph, game_screenshot_confidence,
	         game_screenshot_probabilities, featured_at, featured_by,
	         hidden_at, hidden_by, created_at)
	      VALUES (?,?,?,?,?,?,?, ?,?,?,?,?, ?,?, ?,?,?,?, ?)`,
	bindings: (r: GameScreenshotRow) => [
		r.screenshot_id,
		r.game_id,
		r.user_id,
		r.r2_key,
		r.width,
		r.height,
		r.size_bytes,
		r.caption,
		r.is_old_world,
		r.contains_nsfw,
		r.contains_gore,
		r.is_a_photograph,
		r.game_screenshot_confidence,
		r.game_screenshot_probabilities,
		r.featured_at,
		r.featured_by,
		r.hidden_at,
		r.hidden_by,
		r.created_at,
	],
};

export const screenshotReportInsert = {
	sql: `INSERT INTO screenshot_reports
	        (screenshot_id, reporter_user_id, reason, created_at, resolved_at,
	         resolved_by)
	      VALUES (?,?,?,?,?,?)`,
	bindings: (r: ScreenshotReportRow) => [
		r.screenshot_id,
		r.reporter_user_id,
		r.reason,
		r.created_at,
		r.resolved_at,
		r.resolved_by,
	],
};
