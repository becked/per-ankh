// /v1/stats endpoint — cross-game aggregate statistics for the cloud
// dashboard at /dashboard.
//
// Mirrors the desktop overview's two Tauri commands (get_game_statistics +
// get_save_dates) so the cloud Dashboard.svelte renders the same charts:
// total games card, "Games by Nation" bar chart, 6-month nation calendar.
//
// Spec §4 sketches a richer response (win_rate, victory_types, recent_games);
// that's deferred until a cloud-only dashboard tab needs it. Desktop parity
// first.

import {
	cloudCorsHeaders,
	errorResponse,
	jsonResponse,
} from "./util";
import { sessionFromRequest } from "./session";
import type { SessionEnv } from "./session";

export interface StatsEnv extends SessionEnv {
	SHARE_DB: D1Database;
	ALLOWED_ORIGINS: string;
}

export async function handleStats(
	request: Request,
	env: StatsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	const userId = session.data.user_id;

	// All queries are cheap aggregations on the games table; run in
	// parallel since D1 prepared statements don't share state.
	const [totalRow, nationsResult, datesResult, winRateRow, dayRow] = await Promise.all([
		env.SHARE_DB
			.prepare("SELECT COUNT(*) AS total FROM games WHERE user_id = ?")
			.bind(userId)
			.first<{ total: number }>(),
		env.SHARE_DB
			.prepare(
				`SELECT user_nation AS nation, COUNT(*) AS games_played
				 FROM games
				 WHERE user_id = ? AND user_nation IS NOT NULL
				 GROUP BY user_nation
				 ORDER BY games_played DESC`,
			)
			.bind(userId)
			.all<{ nation: string; games_played: number }>(),
		// save_date is stored as ISO 8601 (parser emits e.g.
		// "2025-12-27T23:37:02"); slice to YYYY-MM-DD for the calendar
		// chart, which buckets per day. Filter NULLs so the calendar
		// doesn't render empty cells for save-date-less imports.
		env.SHARE_DB
			.prepare(
				`SELECT substr(save_date, 1, 10) AS date,
				        user_nation AS nation
				 FROM games
				 WHERE user_id = ? AND save_date IS NOT NULL`,
			)
			.bind(userId)
			.all<{ date: string; nation: string | null }>(),
		// Win rate over games with a known outcome. Observer-mode uploads
		// store user_won as NULL and are excluded. Returns NULL if no games
		// have an outcome (SQLite division by zero yields NULL, no error).
		env.SHARE_DB
			.prepare(
				`SELECT CAST(SUM(CASE WHEN user_won = TRUE THEN 1 ELSE 0 END) AS REAL)
				          / COUNT(*) AS rate,
				        COUNT(*) AS games_with_outcome
				 FROM games
				 WHERE user_id = ? AND user_won IS NOT NULL`,
			)
			.bind(userId)
			.first<{ rate: number | null; games_with_outcome: number }>(),
		// Most-frequent weekday among save dates. strftime('%w') returns
		// 0=Sunday..6=Saturday. Tiebreak by weekday ASC so the result is
		// stable when counts are equal.
		env.SHARE_DB
			.prepare(
				`SELECT CAST(strftime('%w', save_date) AS INTEGER) AS weekday
				 FROM games
				 WHERE user_id = ? AND save_date IS NOT NULL
				 GROUP BY weekday
				 ORDER BY COUNT(*) DESC, weekday ASC
				 LIMIT 1`,
			)
			.bind(userId)
			.first<{ weekday: number | null }>(),
	]);

	return jsonResponse(
		{
			total_games: totalRow?.total ?? 0,
			nations: nationsResult.results ?? [],
			save_dates: datesResult.results ?? [],
			win_rate: winRateRow?.rate ?? null,
			games_with_outcome: winRateRow?.games_with_outcome ?? 0,
			favorite_day_of_week: dayRow?.weekday ?? null,
		},
		200,
		cors,
	);
}
