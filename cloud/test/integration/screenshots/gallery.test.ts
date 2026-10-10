// The two gallery reads and the owner's delete (issue #289, step 5).
//
// These are the first readers of game_screenshots, so what they pin is mostly
// about visibility: `hidden_at` is the only filter either read applies, and
// the invariant that makes that safe (a screenshot requires a public game) is
// enforced by the upload gate and by handleGamePatch, not here.
//
// The Clef call is stubbed, as in upload.test.ts — these tests need stored
// rows, not a classifier verdict, so the stub is the clean-accept one and only
// the queue test moves it.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	expectErrorCode,
	expectOk,
	expectStatus,
} from "../../helpers/assertions";
import { makeUser, type TestUser } from "../../helpers/builders";
import { seedGame } from "../../helpers/games";
import { postMultipart, request } from "../../helpers/requests";
import { screenshotForm } from "../../helpers/screenshot-image";
import { SCORE_ID } from "../../../src/screenshots/clef";
import { SCREENSHOT_VIEW_PER_HOUR } from "../../../src/screenshots/handlers";
import { gameScreenshotPrefix } from "../../../src/screenshots/storage";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// ---------- The stubbed classifier ----------

type Nouls = Record<string, number>;

const CLEAN: Nouls = {
	is_old_world: 0.8,
	contains_nsfw: 0.02,
	contains_gore: 0.03,
	is_a_photograph: 0.03,
};

// The review band on is_old_world: stored, hidden, object kept. What a reader
// must not show.
const QUEUED: Nouls = { ...CLEAN, is_old_world: 0.15 };

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
		probabilities: { "3": 0.3, "4": 0.6 },
		confidence: 0.9,
	};
	return { model: "clef", answers, usage: { input_tokens: 1742 } };
}

beforeEach(() => {
	answer = () => clefResponse(CLEAN);
	(env as unknown as { AI: unknown }).AI = {
		run: async () => answer(),
	};
});

// ---------- Fixtures ----------

interface ReadScreenshot {
	screenshot_id: string;
	game_id: string;
	url: string;
	thumb_url: string;
	width: number;
	height: number;
	caption: string | null;
	game?: {
		game_name: string | null;
		display_name: string | null;
		user_nation: string | null;
		total_turns: number | null;
	};
}

async function readyUser(): Promise<{ user: TestUser; gameId: string }> {
	const user = await makeUser();
	await expectOk(
		await request.post({
			path: "/v1/users/me/screenshot-terms",
			as: user,
			body: { accepted: true },
		}),
	);
	const gameId = await seedGame(user, { isPublic: true });
	return { user, gameId };
}

async function upload(
	user: TestUser,
	gameId: string,
	caption?: string,
): Promise<string> {
	const res = await postMultipart({
		path: `/v1/games/${gameId}/screenshots`,
		form: screenshotForm(caption === undefined ? undefined : { caption }),
		as: user,
	});
	const body = await expectOk<{ screenshot: { screenshot_id: string } }>(res);
	return body.screenshot.screenshot_id;
}

function gameShots(gameId: string, as?: TestUser): Promise<Response> {
	return request.get({ path: `/v1/games/${gameId}/screenshots`, as });
}

function userShots(userId: string, as?: TestUser): Promise<Response> {
	return request.get({ path: `/v1/users/${userId}/screenshots`, as });
}

async function objectKeys(gameId: string): Promise<string[]> {
	const listed = await env.SCREENSHOT_BUCKET.list({
		prefix: gameScreenshotPrefix(gameId),
	});
	return listed.objects.map((o) => o.key);
}

// ---------- GET /v1/games/:id/screenshots ----------

describe("GET /v1/games/:id/screenshots", () => {
	it("serves a game's shots newest first, to anyone, with both URLs", async () => {
		const { user, gameId } = await readyUser();
		const first = await upload(user, gameId, "Early city");
		const second = await upload(user, gameId, "Late empire");

		// No session: the objects are public, so the metadata is too.
		const body = await expectOk<{ screenshots: ReadScreenshot[] }>(
			await gameShots(gameId),
		);
		expect(body.screenshots.map((s) => s.screenshot_id)).toEqual([
			second,
			first,
		]);
		const shot = body.screenshots[0];
		expect(shot.caption).toBe("Late empire");
		// Built from SCREENSHOT_BASE_URL plus the object key, and the tile is a
		// transformation of that same object — one stored object, two addresses.
		expect(shot.url).toBe(
			`${env.SCREENSHOT_BASE_URL}/screenshots/${gameId}/${second}.webp`,
		);
		expect(shot.thumb_url).toContain("/cdn-cgi/image/");
		expect(
			shot.thumb_url.endsWith(`/screenshots/${gameId}/${second}.webp`),
		).toBe(true);
		// The game read names no game — the strip is already under its header.
		expect(shot.game).toBeUndefined();
	});

	it("hides a queued screenshot from the strip while keeping its object", async () => {
		const { user, gameId } = await readyUser();
		const visible = await upload(user, gameId);
		answer = () => clefResponse(QUEUED);
		const queued = await upload(user, gameId);

		const body = await expectOk<{ screenshots: ReadScreenshot[] }>(
			await gameShots(gameId),
		);
		expect(body.screenshots.map((s) => s.screenshot_id)).toEqual([visible]);
		// Not deleted — it is waiting on an admin, so the bytes are still there.
		expect(await objectKeys(gameId)).toHaveLength(2);
		// Nor to its own uploader: `hidden_at` is the only filter, and it does
		// not know who is asking.
		const owner = await expectOk<{ screenshots: ReadScreenshot[] }>(
			await gameShots(gameId, user),
		);
		expect(owner.screenshots.map((s) => s.screenshot_id)).toEqual([visible]);
		expect(queued).toBeTruthy();
	});

	it("answers an empty strip for a game with none, and for no such game", async () => {
		const { gameId } = await readyUser();
		const mine = await expectOk<{ screenshots: ReadScreenshot[] }>(
			await gameShots(gameId),
		);
		expect(mine.screenshots).toEqual([]);
		// A read against the screenshots table, not against the game — an
		// unknown id simply has none, which costs no second query to say.
		const missing = await expectOk<{ screenshots: ReadScreenshot[] }>(
			await gameShots("0123456789abcdefghijk"),
		);
		expect(missing.screenshots).toEqual([]);
	});
});

// ---------- GET /v1/users/:id/screenshots ----------

describe("GET /v1/users/:user_id/screenshots", () => {
	it("spans the user's games and names each tile's game", async () => {
		const { user, gameId } = await readyUser();
		const otherGame = await seedGame(user, {
			isPublic: true,
			gameName: "Second Save",
		});
		const onFirst = await upload(user, gameId);
		const onSecond = await upload(user, otherGame);

		const body = await expectOk<{ screenshots: ReadScreenshot[] }>(
			await userShots(user.userId),
		);
		expect(body.screenshots.map((s) => s.screenshot_id)).toEqual([
			onSecond,
			onFirst,
		]);
		expect(body.screenshots.map((s) => s.game_id)).toEqual([otherGame, gameId]);
		// Raw title fields, formatted client-side by formatGameTitle — the shape
		// the games list uses.
		expect(body.screenshots[0].game?.game_name).toBe("Second Save");
		expect(body.screenshots[0].game?.total_turns).toBe(50);
	});

	it("leaves another user's shots out, and queued ones too", async () => {
		const { user, gameId } = await readyUser();
		await upload(user, gameId);
		answer = () => clefResponse(QUEUED);
		await upload(user, gameId);
		answer = () => clefResponse(CLEAN);

		const other = await readyUser();
		await upload(other.user, other.gameId);

		const mine = await expectOk<{ screenshots: ReadScreenshot[] }>(
			await userShots(user.userId),
		);
		expect(mine.screenshots).toHaveLength(1);
		expect(mine.screenshots[0].game_id).toBe(gameId);
	});

	it("drives the profile's has_screenshots flag off the same filter", async () => {
		const { user, gameId } = await readyUser();
		const before = await expectOk<{ has_screenshots: boolean }>(
			await request.get({ path: `/v1/users/${user.userId}` }),
		);
		expect(before.has_screenshots).toBe(false);

		// A queued upload is not a tab: the flag tests `hidden_at IS NULL`, the
		// same predicate the read applies, so the trigger can't disagree with
		// the payload in either direction.
		answer = () => clefResponse(QUEUED);
		await upload(user, gameId);
		const queued = await expectOk<{ has_screenshots: boolean }>(
			await request.get({ path: `/v1/users/${user.userId}` }),
		);
		expect(queued.has_screenshots).toBe(false);

		answer = () => clefResponse(CLEAN);
		await upload(user, gameId);
		const after = await expectOk<{ has_screenshots: boolean }>(
			await request.get({ path: `/v1/users/${user.userId}` }),
		);
		expect(after.has_screenshots).toBe(true);
	});
});

// ---------- The shared read budget ----------

// Seeded to the ceiling per test on its own IP, the shape the challenge and
// tournament read-limit tests use — the counter is `events` rows in a shared
// isolate, so a per-test IP is what keeps these independent of each other and
// of every other read above.
async function seedViews(ip: string, count: number): Promise<void> {
	await env.SHARE_DB.prepare(
		`INSERT INTO events (event_type, ip_address)
		 WITH RECURSIVE seq(i) AS (
		   SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < ?
		 )
		 SELECT 'screenshot_view', ? FROM seq`,
	)
		.bind(count, ip)
		.run();
}

async function countViews(ip: string): Promise<number> {
	const row = await env.SHARE_DB.prepare(
		`SELECT COUNT(*) AS n FROM events
		 WHERE event_type = 'screenshot_view' AND ip_address = ?`,
	)
		.bind(ip)
		.first<{ n: number }>();
	return row?.n ?? 0;
}

// The audit INSERT that spends a slot is fire-and-forget; poll.
async function expectViewsToReach(ip: string, expected: number): Promise<void> {
	for (let i = 0; i < 50; i++) {
		if ((await countViews(ip)) >= expected) break;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	expect(await countViews(ip)).toBe(expected);
}

// getClientIp trusts CF-Connecting-IP only alongside CF-RAY.
function getFromIp(path: string, ip: string, ua?: string): Promise<Response> {
	const headers: Record<string, string> = {
		"CF-Connecting-IP": ip,
		"CF-RAY": "test-ray",
	};
	if (ua) headers["User-Agent"] = ua;
	return SELF.fetch(`http://test${path}`, { headers });
}

describe("the gallery read budget", () => {
	it("records one screenshot_view per gallery read", async () => {
		const ip = "203.0.113.90";
		const { user, gameId } = await readyUser();
		await expectStatus(
			await getFromIp(`/v1/games/${gameId}/screenshots`, ip),
			200,
		);
		await expectViewsToReach(ip, 1);
		await expectStatus(
			await getFromIp(`/v1/users/${user.userId}/screenshots`, ip),
			200,
		);
		await expectViewsToReach(ip, 2);
	});

	it("is ONE budget, so either read spends what the other is refused for", async () => {
		const ip = "203.0.113.91";
		const { user, gameId } = await readyUser();
		await seedViews(ip, SCREENSHOT_VIEW_PER_HOUR);
		// Both endpoints, one bucket: they are each one read per gallery viewed,
		// so there is nothing a second budget would protect.
		await expectErrorCode(
			await getFromIp(`/v1/games/${gameId}/screenshots`, ip),
			{ status: 429, code: "RATE_LIMIT_SCREENSHOT_VIEW" },
		);
		await expectErrorCode(
			await getFromIp(`/v1/users/${user.userId}/screenshots`, ip),
			{ status: 429, code: "RATE_LIMIT_SCREENSHOT_VIEW" },
		);
	});

	it("exempts a scraper User-Agent, and charges it nothing", async () => {
		const ip = "203.0.113.92";
		const { gameId } = await readyUser();
		await seedViews(ip, SCREENSHOT_VIEW_PER_HOUR);
		await expectStatus(
			await getFromIp(`/v1/games/${gameId}/screenshots`, ip, "Twitterbot/1.0"),
			200,
		);
		// Still exactly what was seeded: a link-preview fetch fans out load
		// that is not meaningful to count.
		expect(await countViews(ip)).toBe(SCREENSHOT_VIEW_PER_HOUR);
	});

	it("the configured ceiling var is the constant", () => {
		expect(env.SCREENSHOT_VIEW_PER_HOUR).toBe(String(SCREENSHOT_VIEW_PER_HOUR));
	});
});

// ---------- DELETE /v1/games/:id/screenshots/:screenshot_id ----------

describe("DELETE /v1/games/:id/screenshots/:screenshot_id", () => {
	it("removes the row and the object, and is not repeatable", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		expect(await objectKeys(gameId)).toHaveLength(1);

		await expectOk(
			await request.delete({
				path: `/v1/games/${gameId}/screenshots/${id}`,
				as: user,
			}),
		);
		expect(await objectKeys(gameId)).toHaveLength(0);
		const body = await expectOk<{ screenshots: ReadScreenshot[] }>(
			await gameShots(gameId),
		);
		expect(body.screenshots).toEqual([]);

		// The row is gone, so a second attempt reads as "no such screenshot".
		await expectErrorCode(
			await request.delete({
				path: `/v1/games/${gameId}/screenshots/${id}`,
				as: user,
			}),
			{ status: 404, code: "NOT_FOUND" },
		);
	});

	it("is the owner's alone, and 404s the same way for every refusal", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		const stranger = await makeUser();

		await expectErrorCode(
			await request.delete({
				path: `/v1/games/${gameId}/screenshots/${id}`,
			}),
			{ status: 401, code: "UNAUTHORIZED" },
		);
		// Not yours, wrong game, and no such screenshot are one answer: the
		// shape the upload's own 404 uses, so nothing leaks existence.
		await expectErrorCode(
			await request.delete({
				path: `/v1/games/${gameId}/screenshots/${id}`,
				as: stranger,
			}),
			{ status: 404, code: "NOT_FOUND" },
		);
		const otherGame = await seedGame(user, { isPublic: true });
		await expectErrorCode(
			await request.delete({
				path: `/v1/games/${otherGame}/screenshots/${id}`,
				as: user,
			}),
			{ status: 404, code: "NOT_FOUND" },
		);
		// All three refusals left it alone.
		expect(await objectKeys(gameId)).toHaveLength(1);
	});

	it("is what lets an owner make a game private again", async () => {
		// The reason the endpoint exists: HAS_SCREENSHOTS names removing them
		// as its remedy, and before step 5 no route could.
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		await expectErrorCode(
			await request.patch({
				path: `/v1/games/${gameId}`,
				as: user,
				body: { is_public: false },
			}),
			{ status: 409, code: "HAS_SCREENSHOTS" },
		);

		await expectOk(
			await request.delete({
				path: `/v1/games/${gameId}/screenshots/${id}`,
				as: user,
			}),
		);
		await expectOk(
			await request.patch({
				path: `/v1/games/${gameId}`,
				as: user,
				body: { is_public: false },
			}),
		);
		const row = await env.SHARE_DB.prepare(
			"SELECT is_public FROM games WHERE game_id = ?",
		)
			.bind(gameId)
			.first<{ is_public: number }>();
		expect(row?.is_public).toBe(0);
	});

	it("removes a queued screenshot too", async () => {
		// A review-band row is stored hidden with its object kept, so it is
		// deletable even though nothing renders it — otherwise an owner could
		// be held public by a screenshot they cannot see.
		const { user, gameId } = await readyUser();
		answer = () => clefResponse(QUEUED);
		const id = await upload(user, gameId);
		expect(await objectKeys(gameId)).toHaveLength(1);

		await expectOk(
			await request.delete({
				path: `/v1/games/${gameId}/screenshots/${id}`,
				as: user,
			}),
		);
		expect(await objectKeys(gameId)).toHaveLength(0);
	});

	it("writes a screenshot_delete audit row", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		await expectOk(
			await request.delete({
				path: `/v1/games/${gameId}/screenshots/${id}`,
				as: user,
			}),
		);
		const row = await env.SHARE_DB.prepare(
			`SELECT metadata FROM events
			 WHERE event_type = 'screenshot_delete' AND user_id = ?`,
		)
			.bind(user.userId)
			.first<{ metadata: string }>();
		expect(row).toBeTruthy();
		expect(JSON.parse(row!.metadata)).toMatchObject({
			screenshot_id: id,
			game_id: gameId,
		});
	});
});
