// The upload side of challenge maps: what handleGameUpload needs to accept a
// run. Split from handlers.ts so games.ts imports only the two functions it
// calls (the handlers import games.ts back for the shared helpers).
//
// Design: docs/challenge-maps-design.md §7 (upload flow).

import { nanoid } from "nanoid";
import type { ChallengeRules, Verdict } from "./types";
import type { QueryableD1 } from "../d1";
import { assignToNamedCollection } from "../games";
import { logError } from "../log";

// What the upload path carries from the challenge row: the rules the run is
// scored against, and the two things the response and the collection name
// need.
export interface ChallengeUploadContext {
	challenge_id: string;
	number: number;
	rules: ChallengeRules;
	closed: boolean;
}

// A challenge row as D1 stores it: rule columns are JSON text.
interface ChallengeRulesRow {
	challenge_id: string;
	number: number;
	setup: string;
	objectives: string;
	criteria: string;
	closed: number;
}

export function parseRules(
	row: Pick<ChallengeRulesRow, "setup" | "objectives" | "criteria">,
): ChallengeRules {
	return {
		setup: JSON.parse(row.setup),
		objectives: JSON.parse(row.objectives),
		criteria: JSON.parse(row.criteria),
	};
}

// `closed` is computed in SQL against the same clock every other read uses,
// so a run uploaded a second after closes_at is refused by the row it was
// scored against — not by a JS Date the Worker happened to have.
export async function loadChallengeForUpload(
	db: QueryableD1,
	challengeId: string,
): Promise<ChallengeUploadContext | null> {
	const row = await db
		.prepare(
			`SELECT challenge_id, number, setup, objectives, criteria,
			        (closes_at <= datetime('now')) AS closed
			 FROM challenges WHERE challenge_id = ?`,
		)
		.bind(challengeId)
		.first<ChallengeRulesRow>();
	if (!row) return null;
	return {
		challenge_id: row.challenge_id,
		number: row.number,
		rules: parseRules(row),
		closed: row.closed === 1,
	};
}

// The submission row for an accepted run. A met verdict always carries the
// turn it was met on; a null here is a scorer bug, and a 0 would sort to the
// top of the leaderboard, so it throws rather than stores.
export function submissionRow(
	challenge: ChallengeUploadContext,
	gameId: string,
	userId: string,
	verdict: Verdict,
	existing: ChallengeSubmissionRow | null,
): ChallengeSubmissionRow {
	if (verdict.score_turn == null) {
		throw new Error("a met challenge verdict carries no score_turn");
	}
	return {
		submission_id: existing?.submission_id ?? nanoid(21),
		challenge_id: challenge.challenge_id,
		game_id: gameId,
		user_id: userId,
		score_turn: verdict.score_turn,
		verdict: JSON.stringify(verdict),
		created_at: existing?.created_at ?? null,
	};
}

// Record an accepted run: the game moves into the uploader's "Challenge #N"
// collection (forced public — the leaderboard links to it) and the verdict is
// persisted as scored at upload. game_id is UNIQUE on the table, so a re-run
// on a dedup hit updates the verdict in place — the insert is an upsert that
// keeps created_at, the leaderboard's first-to-finish tiebreak. Failures are
// logged and never reject the upload — the game row already exists.
export async function linkChallengeSubmission(
	db: QueryableD1,
	gameId: string,
	userId: string,
	challenge: ChallengeUploadContext,
	verdict: Verdict,
): Promise<void> {
	try {
		await assignToNamedCollection(
			db,
			gameId,
			userId,
			`Challenge #${challenge.number}`,
		);
		await db
			.prepare(challengeSubmissionInsert.sql)
			.bind(
				...challengeSubmissionInsert.bindings(
					submissionRow(challenge, gameId, userId, verdict, null),
				),
			)
			.run();
	} catch (e) {
		logError("challenge_link_failed", e, {
			game_id: gameId,
			challenge_id: challenge.challenge_id,
		});
	}
}

// The submission row as stored. The re-import path needs it whole: INSERT OR
// REPLACE on the games row cascades the submission away, so handleGameUpload
// captures it before the batch and re-inserts it inside, with the fresh
// verdict when the re-import is itself a run and the old one otherwise —
// created_at preserved either way, so the first-to-finish tiebreak doesn't
// move.
export interface ChallengeSubmissionRow {
	submission_id: string;
	challenge_id: string;
	game_id: string;
	user_id: string;
	score_turn: number;
	verdict: string;
	created_at: string | null;
}

// An upsert on the one-run-per-game key: a second submission of a game
// rescores it (challenge, uploader and verdict follow the new upload) and
// keeps its submission_id and created_at.
export const challengeSubmissionInsert = {
	sql: `INSERT INTO challenge_submissions
	        (submission_id, challenge_id, game_id, user_id, score_turn, verdict, created_at)
	      VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
	      ON CONFLICT(game_id) DO UPDATE SET
	        challenge_id = excluded.challenge_id,
	        user_id = excluded.user_id,
	        score_turn = excluded.score_turn,
	        verdict = excluded.verdict`,
	bindings: (r: ChallengeSubmissionRow) => [
		r.submission_id,
		r.challenge_id,
		r.game_id,
		r.user_id,
		r.score_turn,
		r.verdict,
		r.created_at,
	],
};

// Whether the game is a run on a challenge that is still open — the guard
// handleGamePatch (going private) and handleGameDelete share, since either
// would pull a live leaderboard's link out from under it. The clock is D1's,
// like every other closes_at comparison.
export async function isRunOnOpenChallenge(
	db: QueryableD1,
	gameId: string,
): Promise<boolean> {
	const run = await db
		.prepare(
			`SELECT 1 FROM challenge_submissions s
			 JOIN challenges c ON c.challenge_id = s.challenge_id
			 WHERE s.game_id = ? AND c.closes_at > datetime('now')
			 LIMIT 1`,
		)
		.bind(gameId)
		.first();
	return run !== null;
}

export async function loadSubmissionForGame(
	db: QueryableD1,
	gameId: string,
): Promise<ChallengeSubmissionRow | null> {
	return db
		.prepare(
			`SELECT submission_id, challenge_id, game_id, user_id, score_turn, verdict, created_at
			 FROM challenge_submissions WHERE game_id = ?`,
		)
		.bind(gameId)
		.first<ChallengeSubmissionRow>();
}
