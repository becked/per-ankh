// The challenge lifecycle end to end through the HTTP surface: a creator
// posts a map, a runner submits saves against it, and the guards around a
// live leaderboard hold. Scoring itself is covered on the unit project
// (src/challenges/scoring.test.ts); this file pins what the handlers do with
// the verdict — what is stored, what is refused, and what the row locks.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import {
	expectErrorCode,
	expectOk,
	expectStatus,
	type ErrorBody,
} from "../../helpers/assertions";
import { makeSiteAdmin, makeUser, type TestUser } from "../../helpers/builders";
import { postMultipart, request } from "../../helpers/requests";
import { buildUploadFormData } from "../../helpers/save-blob";
import { CURRENT_PARSER_VERSION } from "../../../src/schemas/game";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

const OBJECTIVE = { kind: "tech", target: "TECH_IRONWORKING", by_turn: 30 };

interface ChallengeBody {
	challenge: { challenge_id: string; number: number; closes_at: string };
}

interface DetailBody {
	challenge: { challenge_id: string; submission_count: number };
	leaderboard: Array<{ rank: number; score_turn: number; game_id: string }>;
	viewer: { can_manage: boolean; runs: unknown[] } | null;
}

interface SubmissionRow {
	submission_id: string;
	score_turn: number;
	created_at: string;
	verdict: string;
}

// A turn-1 single-human save that isn't over: what validateChallengeMap
// accepts. The GameId is the map's identity, so each map mints its own.
async function mapForm(xmlGameId: string): Promise<FormData> {
	return buildUploadFormData({
		winnerIndex: null,
		humans: 1,
		parserVersion: CURRENT_PARSER_VERSION,
		match: { xmlGameId, totalTurns: 1, gameOver: false },
	});
}

// The same game played on: one human in the map's seat, the tech researched
// on `techTurn` (omit it for a run that never gets there).
async function runForm(opts: {
	xmlGameId: string;
	totalTurns: number;
	techTurn?: number;
	parserVersion?: string;
	nonce?: string;
}): Promise<FormData> {
	return buildUploadFormData({
		winnerIndex: null,
		humans: 1,
		nonce: opts.nonce,
		parserVersion: opts.parserVersion ?? CURRENT_PARSER_VERSION,
		match: {
			xmlGameId: opts.xmlGameId,
			totalTurns: opts.totalTurns,
			gameOver: false,
		},
		techs:
			opts.techTurn == null
				? []
				: [{ player: 0, tech: "TECH_IRONWORKING", turn: opts.techTurn }],
	});
}

async function createChallenge(
	creator: TestUser,
	overrides: Record<string, unknown> = {},
): Promise<{ xmlGameId: string; challenge: ChallengeBody["challenge"] }> {
	const xmlGameId = nanoid(12);
	const form = await mapForm(xmlGameId);
	form.set(
		"meta",
		JSON.stringify({
			title: "Ironworking sprint",
			objectives: [OBJECTIVE],
			criteria: [],
			...overrides,
		}),
	);
	const res = await postMultipart({
		path: "/v1/challenges",
		form,
		as: creator,
	});
	expect(res.status).toBe(201);
	const body = (await res.json()) as ChallengeBody;
	return { xmlGameId, challenge: body.challenge };
}

async function submitRun(
	runner: TestUser,
	challengeId: string,
	form: FormData,
): Promise<Response> {
	form.set("challenge_id", challengeId);
	return postMultipart({ path: "/v1/games", form, as: runner });
}

async function loadSubmission(gameId: string): Promise<SubmissionRow | null> {
	return env.SHARE_DB.prepare(
		`SELECT submission_id, score_turn, created_at, verdict
		 FROM challenge_submissions WHERE game_id = ?`,
	)
		.bind(gameId)
		.first<SubmissionRow>();
}

async function closeChallenge(challengeId: string): Promise<void> {
	await env.SHARE_DB.prepare(
		`UPDATE challenges SET closes_at = datetime('now', '-1 hour')
		 WHERE challenge_id = ?`,
	)
		.bind(challengeId)
		.run();
}

describe("creating a challenge", () => {
	it("numbers from the Discord floor and stores the map's setup", async () => {
		const creator = await makeUser();
		const { challenge } = await createChallenge(creator);
		expect(challenge.number).toBeGreaterThanOrEqual(27);
		const row = await env.SHARE_DB.prepare(
			"SELECT setup FROM challenges WHERE challenge_id = ?",
		)
			.bind(challenge.challenge_id)
			.first<{ setup: string }>();
		const setup = JSON.parse(row!.setup);
		expect(setup.player_index).toBe(0);
		expect(setup.nation).toBe("NATION_EGYPT");
		expect(setup.ai_count).toBe(0);
	});

	it("refuses a save that isn't a turn-1 single-human map, naming why", async () => {
		const creator = await makeUser();
		const form = await buildUploadFormData({
			winnerIndex: 0,
			parserVersion: CURRENT_PARSER_VERSION,
		});
		form.set(
			"meta",
			JSON.stringify({
				title: "Bad map",
				objectives: [OBJECTIVE],
				criteria: [],
			}),
		);
		const res = await postMultipart({
			path: "/v1/challenges",
			form,
			as: creator,
		});
		await expectStatus(res, 400);
		const body = (await res.json()) as ErrorBody & { problems: string[] };
		expect(body.code).toBe("INVALID_MAP");
		expect(body.problems.length).toBeGreaterThan(1);
	});

	it("refuses a map parsed before the challenge floor", async () => {
		const creator = await makeUser();
		const form = await buildUploadFormData({
			winnerIndex: null,
			humans: 1,
			parserVersion: "2.15.0",
			match: { totalTurns: 1, gameOver: false },
		});
		form.set(
			"meta",
			JSON.stringify({
				title: "Old map",
				objectives: [OBJECTIVE],
				criteria: [],
			}),
		);
		const res = await postMultipart({
			path: "/v1/challenges",
			form,
			as: creator,
		});
		await expectErrorCode(res, { status: 400, code: "STALE_PARSER" });
	});
});

describe("submitting a run", () => {
	it("accepts a met run: submission row, leaderboard place, Challenge #N collection", async () => {
		const creator = await makeUser();
		const runner = await makeUser();
		const { xmlGameId, challenge } = await createChallenge(creator);

		const res = await submitRun(
			runner,
			challenge.challenge_id,
			await runForm({ xmlGameId, totalTurns: 25, techTurn: 20 }),
		);
		const body = await expectOk<{
			game_id: string;
			challenge_submitted: boolean;
		}>(res);
		expect(body.challenge_submitted).toBe(true);

		const sub = await loadSubmission(body.game_id);
		expect(sub?.score_turn).toBe(25);
		expect(JSON.parse(sub!.verdict).earliest_turn).toBe(20);

		const collection = await env.SHARE_DB.prepare(
			`SELECT c.name, g.is_public FROM games g
			 JOIN collections c ON c.collection_id = g.collection_id
			 WHERE g.game_id = ?`,
		)
			.bind(body.game_id)
			.first<{ name: string; is_public: number }>();
		expect(collection).toEqual({
			name: `Challenge #${challenge.number}`,
			is_public: 1,
		});

		const detail = await expectOk<DetailBody>(
			await request.get({
				path: `/v1/challenges/${challenge.number}`,
				as: runner,
			}),
		);
		expect(detail.challenge.submission_count).toBe(1);
		expect(detail.leaderboard).toEqual([
			expect.objectContaining({
				rank: 1,
				score_turn: 25,
				game_id: body.game_id,
			}),
		]);
		expect(detail.viewer).toEqual(
			expect.objectContaining({ can_manage: false }),
		);
		expect(detail.viewer?.runs).toHaveLength(1);
	});

	it("refuses an unmet run with the verdict and stores nothing", async () => {
		const creator = await makeUser();
		const runner = await makeUser();
		const { xmlGameId, challenge } = await createChallenge(creator);
		const res = await submitRun(
			runner,
			challenge.challenge_id,
			await runForm({ xmlGameId, totalTurns: 40, techTurn: 35 }),
		);
		await expectStatus(res, 400);
		const body = (await res.json()) as ErrorBody & {
			verdict: { met: boolean; identity: { ok: boolean } };
		};
		expect(body.code).toBe("CHALLENGE_NOT_MET");
		expect(body.verdict.met).toBe(false);
		expect(body.verdict.identity.ok).toBe(true);
		const n = await env.SHARE_DB.prepare(
			"SELECT COUNT(*) AS n FROM games WHERE user_id = ?",
		)
			.bind(runner.userId)
			.first<{ n: number }>();
		expect(n?.n).toBe(0);
	});

	it("refuses a save of a different game, saying so", async () => {
		const creator = await makeUser();
		const runner = await makeUser();
		const { challenge } = await createChallenge(creator);
		const res = await submitRun(
			runner,
			challenge.challenge_id,
			await runForm({ xmlGameId: nanoid(12), totalTurns: 25, techTurn: 20 }),
		);
		await expectStatus(res, 400);
		const body = (await res.json()) as ErrorBody;
		expect(body.code).toBe("CHALLENGE_NOT_MET");
		expect(body.error).toMatch(/GameId/);
	});

	it("refuses a run parsed before the challenge floor", async () => {
		const creator = await makeUser();
		const runner = await makeUser();
		const { xmlGameId, challenge } = await createChallenge(creator);
		const res = await submitRun(
			runner,
			challenge.challenge_id,
			await runForm({
				xmlGameId,
				totalTurns: 25,
				techTurn: 20,
				parserVersion: "2.15.0",
			}),
		);
		await expectErrorCode(res, { status: 400, code: "STALE_PARSER" });
	});

	it("refuses a run on a closed challenge", async () => {
		const creator = await makeUser();
		const runner = await makeUser();
		const { xmlGameId, challenge } = await createChallenge(creator);
		await closeChallenge(challenge.challenge_id);
		const res = await submitRun(
			runner,
			challenge.challenge_id,
			await runForm({ xmlGameId, totalTurns: 25, techTurn: 20 }),
		);
		await expectErrorCode(res, { status: 409, code: "CHALLENGE_CLOSED" });
	});

	it("rescores the same save in place on a dedup hit, keeping created_at", async () => {
		const creator = await makeUser();
		const runner = await makeUser();
		const { xmlGameId, challenge } = await createChallenge(creator);
		const nonce = nanoid(16);
		const first = await expectOk<{ game_id: string }>(
			await submitRun(
				runner,
				challenge.challenge_id,
				await runForm({ xmlGameId, totalTurns: 25, techTurn: 20, nonce }),
			),
		);
		const before = await loadSubmission(first.game_id);
		const again = await expectOk<{
			game_id: string;
			challenge_submitted: boolean;
		}>(
			await submitRun(
				runner,
				challenge.challenge_id,
				await runForm({ xmlGameId, totalTurns: 25, techTurn: 20, nonce }),
			),
		);
		expect(again.game_id).toBe(first.game_id);
		expect(again.challenge_submitted).toBe(true);
		const after = await loadSubmission(first.game_id);
		expect(after?.submission_id).toBe(before?.submission_id);
		expect(after?.created_at).toBe(before?.created_at);
		const rows = await env.SHARE_DB.prepare(
			"SELECT COUNT(*) AS n FROM challenge_submissions WHERE challenge_id = ?",
		)
			.bind(challenge.challenge_id)
			.first<{ n: number }>();
		expect(rows?.n).toBe(1);
	});
});

describe("what a run on the board locks", () => {
	async function challengeWithRun() {
		const creator = await makeUser();
		const runner = await makeUser();
		const { xmlGameId, challenge } = await createChallenge(creator);
		const run = await expectOk<{ game_id: string }>(
			await submitRun(
				runner,
				challenge.challenge_id,
				await runForm({ xmlGameId, totalTurns: 25, techTurn: 20 }),
			),
		);
		return { creator, runner, challenge, gameId: run.game_id };
	}

	it("the rules, but not the title or the duration", async () => {
		const { creator, challenge } = await challengeWithRun();
		const path = `/v1/challenges/${challenge.number}`;
		await expectErrorCode(
			await request.patch({
				path,
				as: creator,
				body: { objectives: [OBJECTIVE] },
			}),
			{ status: 409, code: "CHALLENGE_RULES_LOCKED" },
		);
		await expectOk(
			await request.patch({
				path,
				as: creator,
				body: { title: "Renamed", duration_days: 60 },
			}),
		);
	});

	it("the duration once the challenge has closed", async () => {
		const { creator, challenge } = await challengeWithRun();
		await closeChallenge(challenge.challenge_id);
		await expectErrorCode(
			await request.patch({
				path: `/v1/challenges/${challenge.number}`,
				as: creator,
				body: { duration_days: 365 },
			}),
			{ status: 409, code: "CHALLENGE_CLOSED" },
		);
	});

	it("deletion by the creator, but not by an admin", async () => {
		const { creator, challenge } = await challengeWithRun();
		const path = `/v1/challenges/${challenge.number}`;
		await expectErrorCode(await request.delete({ path, as: creator }), {
			status: 409,
			code: "CHALLENGE_HAS_RUNS",
		});
		const admin = await makeSiteAdmin();
		await expectOk(await request.delete({ path, as: admin }));
		await expectErrorCode(await request.get({ path }), {
			status: 404,
			code: "NOT_FOUND",
		});
	});

	it("the run's game — private or deleted — until the challenge closes", async () => {
		const { runner, challenge, gameId } = await challengeWithRun();
		const path = `/v1/games/${gameId}`;
		await expectErrorCode(
			await request.patch({ path, as: runner, body: { is_public: false } }),
			{ status: 409, code: "LINKED_TO_OPEN_CHALLENGE" },
		);
		await expectErrorCode(await request.delete({ path, as: runner }), {
			status: 409,
			code: "LINKED_TO_OPEN_CHALLENGE",
		});
		await closeChallenge(challenge.challenge_id);
		const res = await request.delete({ path, as: runner });
		expect(res.status).toBe(204);
	});
});
