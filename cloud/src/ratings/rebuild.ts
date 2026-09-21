// The nightly rebuild: every duel D1 can reconstruct, run through the rating
// engine, turned into twelve suggested opponents per player, written back as
// two full-replace caches. Called from the scheduled handler
// (cloud/src/index.ts) and from the admin trigger, which is what an operator
// uses to seed the tables after a deploy rather than waiting for 03:47.
//
// Both tables are caches — everything in them is re-derivable from games and
// tournament results — so a rebuild replaces rather than merges. Pure D1: no
// R2 read, no network.

import type { QueryableD1 } from "../d1";
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
// statements, so a table is replaced across several batches. That rules out
// delete-then-insert: a chunk that throws after the DELETE would leave the
// table truncated site-wide until the next nightly run. Instead every row is
// written in place (INSERT OR REPLACE, stamped with this run's `computed_at`)
// and the rows stamped by an earlier run are swept last. A rebuild that fails
// halfway leaves a mix of old and new rows — every list still full — which is
// the worst case a viewer can see. Two runs overlapping (the admin button
// during the cron) each sweep only what is older than themselves, so the later
// run's rows are the ones that survive.
const BATCH_SIZE = 200;

async function writeInChunks(
	db: QueryableD1,
	statements: D1PreparedStatement[],
): Promise<void> {
	for (let i = 0; i < statements.length; i += BATCH_SIZE) {
		await db.batch(statements.slice(i, i + BATCH_SIZE));
	}
}

// The log fields both callers report, so the cron and the admin trigger
// describe a rebuild the same way.
export function rebuildLogFields(
	result: RatingsRebuildResult,
): Record<string, number> {
	return {
		users: result.users,
		ratable_duels: result.ratableDuels,
		recommended: result.recommended,
		unresolved_opponent: result.stats.unresolvedOpponent,
		ambiguous_online_id: result.stats.ambiguousOnlineId,
	};
}

export async function rebuildRatings(
	db: QueryableD1,
): Promise<RatingsRebuildResult> {
	// One instant for the whole run: what the rows are stamped with, and what
	// the final sweep keeps. Shaped like the columns' datetime('now') default
	// so the table holds one format whoever wrote the row.
	const computedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
	const today = computedAt.slice(0, 10);

	const { duels, stats } = await extractDuels(db);
	const ratings = glicko2(duels);

	// The most recent rated game per player, which is half of "still around"
	// (the other half is their last login). Walked from the same duel list the
	// engine consumed rather than re-queried, so the two can't disagree.
	//
	// The public half is walked alongside it, and only it reaches a badge. A
	// badge is a claim the viewer could check by opening a profile, and a
	// profile shows public games — so `new here` and `active this week` are
	// counted over the results a visitor can see, never over the rating's full
	// input. The rating itself still runs on every duel: nobody is shown it.
	const lastPlayed = new Map<string, string>();
	const publicGames = new Map<string, number>();
	const lastPublicPlayed = new Map<string, string>();
	for (const d of duels) {
		for (const uid of [d.p1, d.p2]) {
			if (d.date > (lastPlayed.get(uid) ?? "")) lastPlayed.set(uid, d.date);
			if (!d.isPublic) continue;
			publicGames.set(uid, (publicGames.get(uid) ?? 0) + 1);
			if (d.date > (lastPublicPlayed.get(uid) ?? "")) {
				lastPublicPlayed.set(uid, d.date);
			}
		}
	}

	// Only cache rows for users the table knows. Nothing deletes a user today,
	// so this guards against the data rather than a case that has happened: a
	// duel naming an id `users` does not hold would have the foreign key
	// reject its whole chunk.
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
		`INSERT OR REPLACE INTO user_ratings
		   (user_id, glicko_r, glicko_rd, glicko_vol, games, last_played, computed_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	);
	const ratingStatements: D1PreparedStatement[] = [];
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
				computedAt,
			),
		);
		players.push({
			userId,
			r: rating.r,
			rd: rating.rd,
			publicGames: publicGames.get(userId) ?? 0,
			lastPublicPlayed: lastPublicPlayed.get(userId) ?? null,
			// Either signal counts: a player mid-match hasn't finished a game in
			// weeks, and one whose opponent uploads every save has no login of
			// their own to show for it.
			lastActive:
				played && user.last_login
					? played > user.last_login
						? played
						: user.last_login
					: (played ?? user.last_login),
			openToMatches: user.open_to_matches === 1,
		});
	}
	ratingStatements.push(
		db
			.prepare("DELETE FROM user_ratings WHERE computed_at < ?")
			.bind(computedAt),
	);
	await writeInChunks(db, ratingStatements);

	const lists = buildRecommendations({ players, duels, today });

	const insertRecommendation = db.prepare(
		`INSERT OR REPLACE INTO user_recommended_opponents
		   (user_id, position, opponent_user_id, meetings, badges, computed_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	);
	const recommendationStatements: D1PreparedStatement[] = [];
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
					computedAt,
				),
			);
		});
	}
	// Lists that got shorter leave their tail positions behind; players who
	// dropped out of the pool leave whole lists. Both go here.
	recommendationStatements.push(
		db
			.prepare("DELETE FROM user_recommended_opponents WHERE computed_at < ?")
			.bind(computedAt),
	);
	await writeInChunks(db, recommendationStatements);

	return {
		users: players.length,
		ratableDuels: duels.length,
		recommended,
		stats,
	};
}
