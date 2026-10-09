// The screenshot upload gate end to end through the HTTP surface (issue #289).
//
// The Clef call is stubbed — env.AI is replaced per test — so what is pinned
// here is everything around it: which gates refuse before any inference is
// spent, that the request sent is the one the threshold eval measured, what
// each band does with the bytes, and that a classifier failure stores nothing.
// The bands themselves are the eval's output, not this file's (the decision
// function is unit-level pure; see cloud/src/screenshots/clef.ts).

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	expectErrorCode,
	expectOk,
	expectStatus,
} from "../../helpers/assertions";
import { makeUser, type TestUser } from "../../helpers/builders";
import { seedGame } from "../../helpers/games";
import { postMultipart, request } from "../../helpers/requests";
import {
	SCREENSHOT_HEIGHT,
	SCREENSHOT_WIDTH,
	screenshotForm,
	tooSmallScreenshotBytes,
} from "../../helpers/screenshot-image";
import { NOUL_IDS, SCORE_ID, STATE } from "../../../src/screenshots/clef";
import {
	MAX_SCREENSHOTS_PER_ACCOUNT,
	MAX_SCREENSHOTS_PER_GAME,
	PER_USER_SCREENSHOTS_PER_HOUR,
	screenshotsPerHour,
} from "../../../src/screenshots/handlers";
import { gameScreenshotPrefix } from "../../../src/screenshots/storage";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// ---------- The stubbed classifier ----------

interface ClefCall {
	model: string;
	body: {
		model?: string;
		state?: string;
		questions?: Record<string, unknown>;
		images?: { content_type: string; base64: string }[];
	};
}

type Nouls = Record<string, number>;

// A clean accept under the shipped bands: well inside is_old_world's floor and
// well under all three reject-direction floors.
const CLEAN: Nouls = {
	is_old_world: 0.8,
	contains_nsfw: 0.02,
	contains_gore: 0.03,
	is_a_photograph: 0.03,
};

let clefCalls: ClefCall[] = [];
let answer: () => unknown = () => clefResponse(CLEAN);

function clefResponse(nouls: Nouls): Record<string, unknown> {
	const answers: Record<string, unknown> = {};
	for (const [id, noul] of Object.entries(nouls)) {
		answers[id] = { type: "noul", noul };
	}
	answers[SCORE_ID] = {
		type: "score",
		score: 3.6,
		legend: {},
		probabilities: { "0": 0.01, "1": 0.02, "2": 0.07, "3": 0.3, "4": 0.6 },
		confidence: 0.9,
	};
	return { model: "clef", answers, usage: { input_tokens: 1742 } };
}

// env.AI is the Workers AI binding, which in a local isolate proxies to the
// real service — so every test replaces it. Restored per test rather than
// once, because a test that makes it throw must not leak that.
beforeEach(() => {
	clefCalls = [];
	answer = () => clefResponse(CLEAN);
	(env as unknown as { AI: unknown }).AI = {
		run: async (model: string, body: ClefCall["body"]) => {
			clefCalls.push({ model, body });
			return answer();
		},
	};
});

// ---------- Fixtures ----------

async function acceptTerms(user: TestUser): Promise<void> {
	const res = await request.post({
		path: "/v1/users/me/screenshot-terms",
		as: user,
		body: { accepted: true },
	});
	await expectOk(res);
}

async function readyUser(): Promise<{ user: TestUser; gameId: string }> {
	const user = await makeUser();
	await acceptTerms(user);
	const gameId = await seedGame(user, { isPublic: true });
	return { user, gameId };
}

function upload(
	user: TestUser,
	gameId: string,
	form: FormData = screenshotForm(),
): Promise<Response> {
	return postMultipart({
		path: `/v1/games/${gameId}/screenshots`,
		form,
		as: user,
	});
}

interface UploadBody {
	screenshot: {
		screenshot_id: string;
		game_id: string;
		url: string;
		width: number;
		height: number;
		size_bytes: number;
		caption: string | null;
		status: string;
		created_at: string;
	};
}

interface ScreenshotRow {
	screenshot_id: string;
	user_id: string;
	r2_key: string;
	width: number;
	height: number;
	caption: string | null;
	is_old_world: number;
	contains_nsfw: number;
	contains_gore: number;
	is_a_photograph: number;
	game_screenshot_confidence: number;
	game_screenshot_probabilities: string;
	hidden_at: string | null;
}

function rowsFor(gameId: string): Promise<ScreenshotRow[]> {
	return env.SHARE_DB.prepare(
		"SELECT * FROM game_screenshots WHERE game_id = ? ORDER BY created_at",
	)
		.bind(gameId)
		.all<ScreenshotRow>()
		.then((r) => r.results ?? []);
}

async function objectKeys(gameId: string): Promise<string[]> {
	// Through the production prefix helper, so the layout the game-delete path
	// lists by is the layout asserted here.
	const listed = await env.SCREENSHOT_BUCKET.list({
		prefix: gameScreenshotPrefix(gameId),
	});
	return listed.objects.map((o) => o.key);
}

// Fills an account's quota without driving the endpoint 100 times — the gates
// read COUNT(*), so seeded rows spend the cap the same way stored ones do. A
// recursive CTE because D1 caps bound parameters well below 100.
async function fillAccountQuota(
	user: TestUser,
	gameId: string,
	count: number,
): Promise<void> {
	await env.SHARE_DB.prepare(
		`INSERT INTO game_screenshots
		   (screenshot_id, game_id, user_id, r2_key, width, height, size_bytes,
		    is_old_world, contains_nsfw, contains_gore, is_a_photograph,
		    game_screenshot_confidence, game_screenshot_probabilities)
		 WITH RECURSIVE seq(i) AS (
		   SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < ?
		 )
		 SELECT 'seed-' || ? || '-' || i, ?, ?,
		        'screenshots/' || ? || '/seed-' || i || '.webp',
		        800, 600, 1024, 0.8, 0.02, 0.03, 0.03, 3.6, '{}'
		 FROM seq`,
	)
		.bind(count, gameId, gameId, user.userId, gameId)
		.run();
}

// ---------- Terms ----------

describe("POST /v1/users/me/screenshot-terms", () => {
	it("stamps the acceptance and is idempotent", async () => {
		const user = await makeUser();
		const first = await expectOk<{ screenshot_terms_accepted_at: string }>(
			await request.post({
				path: "/v1/users/me/screenshot-terms",
				as: user,
				body: { accepted: true },
			}),
		);
		expect(first.screenshot_terms_accepted_at).toBeTruthy();
		// A second POST is not a second agreement: the original timestamp stands.
		const second = await expectOk<{ screenshot_terms_accepted_at: string }>(
			await request.post({
				path: "/v1/users/me/screenshot-terms",
				as: user,
				body: { accepted: true },
			}),
		);
		expect(second.screenshot_terms_accepted_at).toBe(
			first.screenshot_terms_accepted_at,
		);
	});

	it("requires the affirmative and a session", async () => {
		const user = await makeUser();
		await expectErrorCode(
			await request.post({
				path: "/v1/users/me/screenshot-terms",
				as: user,
				body: { accepted: false },
			}),
			{ status: 400, code: "INVALID_BODY" },
		);
		await expectErrorCode(
			await request.post({ path: "/v1/users/me/screenshot-terms" }),
			{ status: 401, code: "UNAUTHORIZED" },
		);
	});
});

// ---------- The gates before the classifier ----------

describe("upload gates", () => {
	it("refuses without accepted terms, before spending a Clef call", async () => {
		const user = await makeUser();
		const gameId = await seedGame(user, { isPublic: true });
		await expectErrorCode(await upload(user, gameId), {
			status: 403,
			code: "TERMS_NOT_ACCEPTED",
		});
		expect(clefCalls).toHaveLength(0);
	});

	it("refuses a private game, and 404s someone else's", async () => {
		const { user } = await readyUser();
		const privateGame = await seedGame(user, { isPublic: false });
		await expectErrorCode(await upload(user, privateGame), {
			status: 409,
			code: "GAME_NOT_PUBLIC",
		});

		const other = await makeUser();
		await acceptTerms(other);
		const theirs = await seedGame(other, { isPublic: true });
		// Don't leak existence: not-yours reads the same as no-such-game.
		await expectErrorCode(await upload(user, theirs), {
			status: 404,
			code: "NOT_FOUND",
		});
		expect(clefCalls).toHaveLength(0);
	});

	it("refuses an image under the quality floor, and a non-WebP", async () => {
		const { user, gameId } = await readyUser();
		await expectErrorCode(
			await upload(
				user,
				gameId,
				screenshotForm({ bytes: tooSmallScreenshotBytes() }),
			),
			{ status: 400, code: "IMAGE_TOO_SMALL" },
		);
		await expectErrorCode(
			await upload(
				user,
				gameId,
				screenshotForm({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }),
			),
			{ status: 400, code: "INVALID_IMAGE" },
		);
		// The pre-filter is the free check, so it runs before the paid one.
		expect(clefCalls).toHaveLength(0);
	});

	it("charges the hourly budget for attempts, including refused ones", async () => {
		const configured = env.PER_USER_SCREENSHOTS_PER_HOUR;
		try {
			env.PER_USER_SCREENSHOTS_PER_HOUR = "1";
			const { user, gameId } = await readyUser();
			// A refusal after the gate still spends a slot — it is the refused
			// uploads that need bounding, since each one costs a Clef call.
			answer = () => clefResponse({ ...CLEAN, is_a_photograph: 0.95 });
			await expectStatus(await upload(user, gameId), 422);
			answer = () => clefResponse(CLEAN);
			await expectErrorCode(await upload(user, gameId), {
				status: 429,
				code: "RATE_LIMIT_SCREENSHOT_UPLOAD",
			});
			expect(clefCalls).toHaveLength(1);
		} finally {
			env.PER_USER_SCREENSHOTS_PER_HOUR = configured;
		}
	});

	it("holds the per-game cap", async () => {
		const { user, gameId } = await readyUser();
		for (let i = 0; i < MAX_SCREENSHOTS_PER_GAME; i++) {
			await expectStatus(await upload(user, gameId), 201);
		}
		await expectErrorCode(await upload(user, gameId), {
			status: 409,
			code: "GAME_SCREENSHOT_LIMIT",
		});
		expect(await rowsFor(gameId)).toHaveLength(MAX_SCREENSHOTS_PER_GAME);
		// Nothing was stored for the refused one.
		expect(await objectKeys(gameId)).toHaveLength(MAX_SCREENSHOTS_PER_GAME);
	});

	it("holds the per-account cap on a game with room to spare", async () => {
		const { user, gameId } = await readyUser();
		await fillAccountQuota(user, gameId, MAX_SCREENSHOTS_PER_ACCOUNT);
		const fresh = await seedGame(user, { isPublic: true });
		await expectErrorCode(await upload(user, fresh), {
			status: 409,
			code: "ACCOUNT_SCREENSHOT_LIMIT",
		});
		expect(clefCalls).toHaveLength(0);
	});

	it("the configured ceiling var is the constant", () => {
		// Pins that wrangler.toml carries the var and the public host: a test
		// that only exercised the code defaults would pass with neither set.
		expect(env.PER_USER_SCREENSHOTS_PER_HOUR).toBe(
			String(PER_USER_SCREENSHOTS_PER_HOUR),
		);
		expect(screenshotsPerHour(env)).toBe(PER_USER_SCREENSHOTS_PER_HOUR);
		expect(env.SCREENSHOT_BASE_URL).toBe("https://img.per-ankh.app");
	});
});

// ---------- The classifier ----------

describe("the Clef call", () => {
	it("sends the request the thresholds were fitted to", async () => {
		const { user, gameId } = await readyUser();
		await expectStatus(await upload(user, gameId), 201);
		expect(clefCalls).toHaveLength(1);
		const [call] = clefCalls;
		expect(call.model).toBe("@cf/cloudflare/clef");
		// The variant lives in two places and a swap must move both.
		expect(call.body.model).toBe("clef");
		expect(call.body.state).toBe(STATE);
		expect(Object.keys(call.body.questions ?? {})).toEqual([
			...NOUL_IDS,
			SCORE_ID,
		]);
		// The exact bytes that get stored, embedded in the call — remote URLs
		// are not accepted, and the verdict has to bind what R2 holds.
		expect(call.body.images?.[0].content_type).toBe("image/webp");
		expect(call.body.images?.[0].base64.length).toBeGreaterThan(0);
	});

	it("stores an accepted screenshot with its probabilities", async () => {
		const { user, gameId } = await readyUser();
		const body = await expectOk<UploadBody>(
			await upload(user, gameId, screenshotForm({ caption: "  Turn 140  " })),
		);
		expect(body.screenshot.status).toBe("published");
		expect(body.screenshot.width).toBe(SCREENSHOT_WIDTH);
		expect(body.screenshot.height).toBe(SCREENSHOT_HEIGHT);
		expect(body.screenshot.caption).toBe("Turn 140");
		expect(body.screenshot.url).toBe(
			`https://img.per-ankh.app/screenshots/${gameId}/${body.screenshot.screenshot_id}.webp`,
		);

		const [row] = await rowsFor(gameId);
		expect(row.r2_key).toBe(
			`screenshots/${gameId}/${body.screenshot.screenshot_id}.webp`,
		);
		expect(row.user_id).toBe(user.userId);
		expect(row.width).toBe(SCREENSHOT_WIDTH);
		expect(row.hidden_at).toBeNull();
		expect(row.is_old_world).toBeCloseTo(0.8);
		expect(row.contains_nsfw).toBeCloseTo(0.02);
		expect(row.contains_gore).toBeCloseTo(0.03);
		expect(row.is_a_photograph).toBeCloseTo(0.03);
		expect(row.game_screenshot_confidence).toBeCloseTo(3.6);
		expect(JSON.parse(row.game_screenshot_probabilities)).toMatchObject({
			"4": 0.6,
		});

		// The object is in R2, with the content type the public host serves.
		const stored = await env.SCREENSHOT_BUCKET.get(row.r2_key);
		expect(stored).not.toBeNull();
		expect(stored!.httpMetadata?.contentType).toBe("image/webp");
	});

	it("queues the uncertain middle band, hidden, with its object kept", async () => {
		const { user, gameId } = await readyUser();
		// Under the nsfw review floor of 0.09 nothing is refused outright —
		// that question has no auto-reject bound, by design.
		answer = () => clefResponse({ ...CLEAN, contains_nsfw: 0.4 });
		const body = await expectOk<UploadBody>(await upload(user, gameId));
		expect(body.screenshot.status).toBe("in_review");
		const [row] = await rowsFor(gameId);
		expect(row.hidden_at).not.toBeNull();
		// Hidden from every reader, but the bytes stay for the admin to look at.
		expect(await objectKeys(gameId)).toEqual([row.r2_key]);
	});

	it("refuses the reject band and stores nothing", async () => {
		const { user, gameId } = await readyUser();
		answer = () => clefResponse({ ...CLEAN, is_a_photograph: 0.95 });
		const res = await upload(user, gameId);
		await expectErrorCode(res, { status: 422, code: "SCREENSHOT_REJECTED" });
		expect(await rowsFor(gameId)).toHaveLength(0);
		expect(await objectKeys(gameId)).toHaveLength(0);
	});

	it("rejects on a low is_old_world — the allowlist runs the other way", async () => {
		const { user, gameId } = await readyUser();
		answer = () => clefResponse({ ...CLEAN, is_old_world: 0.04 });
		const res = await upload(user, gameId);
		await expectErrorCode(res, { status: 422, code: "SCREENSHOT_REJECTED" });
		expect(await rowsFor(gameId)).toHaveLength(0);
	});

	it("never lets a confident is_old_world relax a safety question", async () => {
		const { user, gameId } = await readyUser();
		// Bands are conjunctive, never compensatory: the gate screens for
		// inappropriate content rather than identifying the game.
		answer = () =>
			clefResponse({ ...CLEAN, is_old_world: 0.99, contains_gore: 0.6 });
		const body = await expectOk<UploadBody>(await upload(user, gameId));
		expect(body.screenshot.status).toBe("in_review");
	});

	it("fails closed when the classifier errors", async () => {
		const { user, gameId } = await readyUser();
		answer = () => {
			throw new Error("inference down");
		};
		await expectErrorCode(await upload(user, gameId), {
			status: 503,
			code: "CLASSIFIER_UNAVAILABLE",
		});
		expect(await rowsFor(gameId)).toHaveLength(0);
		expect(await objectKeys(gameId)).toHaveLength(0);
	});

	it("fails closed on an answer it cannot read", async () => {
		const { user, gameId } = await readyUser();
		// A question renamed on the model's side, or a response shape change:
		// either means the request and the bands have drifted apart.
		answer = () => ({ model: "clef", answers: {}, usage: {} });
		await expectErrorCode(await upload(user, gameId), {
			status: 503,
			code: "CLASSIFIER_UNAVAILABLE",
		});
		expect(await rowsFor(gameId)).toHaveLength(0);
	});
});

// ---------- The public-game invariant ----------

describe("a screenshot pins its game public", () => {
	it("refuses to unpublish a game that still has screenshots", async () => {
		const { user, gameId } = await readyUser();
		await expectStatus(await upload(user, gameId), 201);
		await expectErrorCode(
			await request.patch({
				path: `/v1/games/${gameId}`,
				as: user,
				body: { is_public: false },
			}),
			{ status: 409, code: "HAS_SCREENSHOTS" },
		);
		// Still public: the refusal is the whole point.
		const row = await env.SHARE_DB.prepare(
			"SELECT is_public FROM games WHERE game_id = ?",
		)
			.bind(gameId)
			.first<{ is_public: number }>();
		expect(row?.is_public).toBe(1);
	});

	it("takes the objects with the game when it is deleted", async () => {
		const { user, gameId } = await readyUser();
		await expectStatus(await upload(user, gameId), 201);
		expect(await objectKeys(gameId)).toHaveLength(1);

		await expectStatus(
			await request.delete({ path: `/v1/games/${gameId}`, as: user }),
			204,
		);
		// The rows cascade with the game; the objects don't, so the delete
		// path lists the prefix.
		expect(await rowsFor(gameId)).toHaveLength(0);
		expect(await objectKeys(gameId)).toHaveLength(0);
	});
});
