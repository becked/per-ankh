// The nightly rebuild: every duel D1 can reconstruct, run through the rating
// engine, turned into ten suggested opponents per player, written back as two
// full-replace caches. Called from the scheduled handler (cloud/src/index.ts)
// and from the admin trigger, which is what an operator uses to seed the
// tables after a deploy rather than waiting for 03:47.
//
// Both tables are caches — everything in them is re-derivable from games and
// tournament results — so a rebuild replaces rather than merges. Pure D1: no
// R2 read, no network.

import { glicko2 } from "./glicko2";
import { extractDuels, type DuelExtraction } from "./duels";
import {
	buildRecommendations,
	type RecommendationCandidate,
} from "./recommend";

export interface RatingsRebuildResult {
	// Players the engine rated and cached.
	users: number;
	// Duels that survived extraction and de-duplication.
	ratableDuels: number;
	// Players who ended up with at least one suggested opponent.
	recommended: number;
	stats: DuelExtraction["stats"];
}

// D1 caps how much one batch may carry, and a full rebuild is thousands of
// statements. Chunked writes give up single-transaction atomicity for the
// second table, which is the right trade for a cache rebuilt nightly: the
// worst case is a viewer loading the page mid-rebuild and seeing a short list
// for one request.
const BATCH_SIZE = 200;

async function writeInChunks(
	db: D1Database,
	statements: D1PreparedStatement[],
): Promise<void> {
	for (let i = 0; i < statements.length; i += BATCH_SIZE) {
		await db.batch(statements.slice(i, i + BATCH_SIZE));
	}
}

export async function rebuildRatings(
	db: D1Database,
): Promise<RatingsRebuildResult> {
	const { duels, stats } = await extractDuels(db);
	const ratings = glicko2(duels);

	// The most recent rated game per player, which is half of "still around"
	// (the other half is their last login). Walked from the same duel list the
	// engine consumed rather than re-queried, so the two can't disagree.
	const lastPlayed = new Map<string, string>();
	for (const d of duels) {
		for (const uid of [d.p1, d.p2]) {
			if (d.date > (lastPlayed.get(uid) ?? "")) lastPlayed.set(uid, d.date);
		}
	}

	// Only cache rows for users who still exist — the foreign key would reject
	// the whole batch on a rating left behind by a deleted account.
	const userRows = await db
		.prepare(
			`SELECT user_id, open_to_matches, substr(last_login_at, 1, 10) AS last_login
			   FROM users`,
		)
		.all<{
			user_id: string;
			open_to_matches: number;
			last_login: string | null;
		}>();
	const users = new Map(
		(userRows.results ?? []).map((r) => [r.user_id, r] as const),
	);

	const insertRating = db.prepare(
		`INSERT INTO user_ratings
		   (user_id, glicko_r, glicko_rd, glicko_vol, games, last_played)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	);
	const ratingStatements: D1PreparedStatement[] = [
		db.prepare("DELETE FROM user_ratings"),
	];
	const players: RecommendationCandidate[] = [];

	for (const [userId, rating] of Object.entries(ratings)) {
		const user = users.get(userId);
		if (!user) continue;
		const played = lastPlayed.get(userId) ?? null;
		ratingStatements.push(
			insertRating.bind(
				userId,
				rating.r,
				rating.rd,
				rating.vol,
				rating.games,
				played,
			),
		);
		players.push({
			userId,
			r: rating.r,
			rd: rating.rd,
			games: rating.games,
			// Either signal counts: a player mid-match hasn't finished a game in
			// weeks, and one whose opponent uploads every save has no login of
			// their own to show for it.
			lastActive:
				played && user.last_login
					? played > user.last_login
						? played
						: user.last_login
					: (played ?? user.last_login),
			openToMatches: user.open_to_matches !== 0,
		});
	}
	await writeInChunks(db, ratingStatements);

	const today = new Date().toISOString().slice(0, 10);
	const lists = buildRecommendations({ players, duels, today });

	const insertRecommendation = db.prepare(
		`INSERT INTO user_recommended_opponents
		   (user_id, position, opponent_user_id, meetings, badges, map_anchor)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	);
	const recommendationStatements: D1PreparedStatement[] = [
		db.prepare("DELETE FROM user_recommended_opponents"),
	];
	let recommended = 0;
	for (const [userId, list] of lists) {
		if (list.length === 0) continue;
		recommended += 1;
		list.forEach((rec, position) => {
			recommendationStatements.push(
				insertRecommendation.bind(
					userId,
					position,
					rec.opponentUserId,
					rec.meetings,
					JSON.stringify(rec.badges),
					rec.mapAnchor,
				),
			);
		});
	}
	await writeInChunks(db, recommendationStatements);

	return {
		users: players.length,
		ratableDuels: duels.length,
		recommended,
		stats,
	};
}
