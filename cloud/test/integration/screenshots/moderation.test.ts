// Moderation layer 2 (issue #289, step 6): the viewer's report, the admin
// queue, and the five decisions.
//
// What is worth pinning here is almost all about the TWO HIDDEN STATES, which
// is what migration 0051's `hidden_by` exists to tell apart: a classifier-
// queued row still has its object and can be published, while an admin-hidden
// one does not and cannot. Everything else — who may report, what the queue
// selects, what a takedown takes with it — follows from that distinction,
// and
// every one of those is invisible to a reader, because both states filter
// out of the galleries identically.
//
// The Clef call is stubbed as in gallery.test.ts: these tests need stored
// rows in known states, not a classifier verdict.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeSiteAdmin, makeUser, type TestUser } from "../../helpers/builders";
import { seedGame } from "../../helpers/games";
import { postMultipart, request } from "../../helpers/requests";
import { screenshotForm } from "../../helpers/screenshot-image";
import { SCORE_ID } from "../../../src/screenshots/clef";
import { MAX_SCREENSHOTS_PER_GAME } from "../../../src/screenshots/handlers";
import { PER_USER_SCREENSHOT_REPORTS_PER_HOUR } from "../../../src/screenshots/moderation";
import { gameScreenshotPrefix } from "../../../src/screenshots/storage";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	admin = await makeSiteAdmin();
});

// One site admin for the file: users.discord_id is unique and the Worker
// recognizes exactly one.
let admin: TestUser;

// ---------- The stubbed classifier ----------

type Nouls = Record<string, number>;

const CLEAN: Nouls = {
	is_old_world: 0.8,
	contains_nsfw: 0.02,
	contains_gore: 0.03,
	is_a_photograph: 0.03,
};

// Under the review floor on is_old_world: stored, hidden, object kept — the
// state the queue exists for.
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

beforeEach(async () => {
	answer = () => clefResponse(CLEAN);
	(env as unknown as { AI: unknown }).AI = {
		run: async () => answer(),
	};
	// Each case asserts on the whole queue, so start from an empty one rather
	// than threading ids through cases that are about selection and ordering.
	// game_screenshots cascades the reports with it.
	//
	// `events` is reached through SHARE_DB here: the isolate binds one D1 for
	// both, and the test env exposes only that name — the shape every other
	// events assertion in this directory uses.
	await env.SHARE_DB.prepare("DELETE FROM game_screenshots").run();
	await env.SHARE_DB.prepare(
		"DELETE FROM events WHERE event_type IN ('screenshot_report', 'screenshot_moderate')",
	).run();
});

// ---------- Fixtures ----------

interface QueueRow {
	screenshot_id: string;
	game_id: string;
	url: string;
	thumb_url: string;
	status: "published" | "in_review" | "hidden";
	featured_at: string | null;
	caption: string | null;
	uploader: {
		user_id: string;
		display_name: string | null;
		slug: string | null;
	};
	game: {
		game_name: string | null;
		display_name: string | null;
		user_nation: string | null;
		total_turns: number | null;
	};
	clef: {
		is_old_world: number;
		contains_nsfw: number;
		contains_gore: number;
		is_a_photograph: number;
		game_screenshot_confidence: number;
		tripped: string[];
	};
	reports: {
		reason: string;
		created_at: string;
		reporter: { user_id: string; display_name: string | null };
	}[];
}

interface Lists {
	queue: QueueRow[];
	featured: QueueRow[];
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

async function upload(user: TestUser, gameId: string): Promise<string> {
	const res = await postMultipart({
		path: `/v1/games/${gameId}/screenshots`,
		form: screenshotForm(),
		as: user,
	});
	const body = await expectOk<{ screenshot: { screenshot_id: string } }>(res);
	return body.screenshot.screenshot_id;
}

async function uploadQueued(user: TestUser, gameId: string): Promise<string> {
	answer = () => clefResponse(QUEUED);
	const id = await upload(user, gameId);
	answer = () => clefResponse(CLEAN);
	return id;
}

function report(
	gameId: string,
	screenshotId: string,
	reason: string,
	as?: TestUser,
): Promise<Response> {
	return request.post({
		path: `/v1/games/${gameId}/screenshots/${screenshotId}/report`,
		as,
		body: { reason },
	});
}

function moderate(
	screenshotId: string,
	action: string,
	as?: TestUser,
): Promise<Response> {
	return request.post({
		path: `/v1/admin/screenshots/${screenshotId}/moderate`,
		as,
		body: { action },
	});
}

function lists(as?: TestUser): Promise<Response> {
	return request.get({ path: "/v1/admin/screenshots", as });
}

async function objectKeys(gameId: string): Promise<string[]> {
	const listed = await env.SCREENSHOT_BUCKET.list({
		prefix: gameScreenshotPrefix(gameId),
	});
	return listed.objects.map((o) => o.key);
}

async function reportEvents(reporter: TestUser): Promise<number> {
	const row = await env.SHARE_DB.prepare(
		`SELECT COUNT(*) AS count FROM events
		 WHERE event_type = 'screenshot_report' AND user_id = ?`,
	)
		.bind(reporter.userId)
		.first<{ count: number }>();
	return row?.count ?? 0;
}

async function reportRows(
	screenshotId: string,
): Promise<{ reason: string; resolved_at: string | null }[]> {
	const rows = await env.SHARE_DB.prepare(
		`SELECT reason, resolved_at FROM screenshot_reports WHERE screenshot_id = ?`,
	)
		.bind(screenshotId)
		.all<{ reason: string; resolved_at: string | null }>();
	return rows.results ?? [];
}

async function hiddenColumns(
	screenshotId: string,
): Promise<{ hidden_at: string | null; hidden_by: string | null } | null> {
	return await env.SHARE_DB.prepare(
		`SELECT hidden_at, hidden_by FROM game_screenshots WHERE screenshot_id = ?`,
	)
		.bind(screenshotId)
		.first<{ hidden_at: string | null; hidden_by: string | null }>();
}

// ---------- POST /v1/games/:id/screenshots/:screenshot_id/report ----------

describe("POST /v1/games/:id/screenshots/:screenshot_id/report", () => {
	it("records a reporter's report and puts the screenshot in the queue", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		const reporter = await makeUser({ displayName: "Concerned Viewer" });

		await expectOk(await report(gameId, id, "real_person", reporter));

		const body = await expectOk<Lists>(await lists(admin));
		expect(body.queue).toHaveLength(1);
		const row = body.queue[0];
		expect(row.screenshot_id).toBe(id);
		// Still published — a report is not a takedown. The galleries keep
		// rendering it until an admin decides.
		expect(row.status).toBe("published");
		expect(row.reports).toHaveLength(1);
		expect(row.reports[0].reason).toBe("real_person");
		expect(row.reports[0].reporter.user_id).toBe(reporter.userId);
		expect(row.reports[0].reporter.display_name).toBe("Concerned Viewer");
		// The uploader is named too, which is what makes a pattern legible.
		expect(row.uploader.user_id).toBe(user.userId);
	});

	it("requires a session", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		await expectErrorCode(await report(gameId, id, "other"), {
			status: 401,
			code: "UNAUTHORIZED",
		});
		expect(await reportRows(id)).toEqual([]);
	});

	it("refuses the uploader's own screenshot, which has a delete instead", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		await expectErrorCode(await report(gameId, id, "other", user), {
			status: 409,
			code: "OWN_SCREENSHOT",
		});
		expect(await reportRows(id)).toEqual([]);
	});

	it("404s a hidden screenshot, the wrong game, and no such screenshot alike", async () => {
		const { user, gameId } = await readyUser();
		const queued = await uploadQueued(user, gameId);
		const published = await upload(user, gameId);
		const reporter = await makeUser();

		// Hidden: no reader can see it, so a report on one is a stale client.
		await expectErrorCode(await report(gameId, queued, "other", reporter), {
			status: 404,
			code: "NOT_FOUND",
		});
		const otherGame = await seedGame(user, { isPublic: true });
		await expectErrorCode(
			await report(otherGame, published, "other", reporter),
			{ status: 404, code: "NOT_FOUND" },
		);
		await expectErrorCode(
			await report(gameId, "0123456789abcdefghijk", "other", reporter),
			{ status: 404, code: "NOT_FOUND" },
		);
	});

	it("rejects a reason outside the list", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		const reporter = await makeUser();
		await expectErrorCode(await report(gameId, id, "i_dislike_it", reporter), {
			status: 400,
			code: "INVALID_BODY",
		});
	});

	it("keeps one report per reporter: a repeat corrects the reason", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		const reporter = await makeUser();

		await expectOk(await report(gameId, id, "other", reporter));
		await expectOk(await report(gameId, id, "sexual_content", reporter));

		// One row, the corrected reason — not two rows inflating the queue.
		const rows = await reportRows(id);
		expect(rows).toHaveLength(1);
		expect(rows[0].reason).toBe("sexual_content");
	});

	it("does not reopen a report an admin already resolved", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		const reporter = await makeUser();
		await expectOk(await report(gameId, id, "other", reporter));
		await expectOk(await moderate(id, "resolve_reports", admin));

		// The same answer as a fresh report, deliberately: a reporter who could
		// tell them apart could read the admin's decision off the response.
		await expectOk(await report(gameId, id, "graphic_violence", reporter));

		const rows = await reportRows(id);
		expect(rows).toHaveLength(1);
		expect(rows[0].resolved_at).not.toBeNull();
		// The reason is untouched too — the row is closed, not edited.
		expect(rows[0].reason).toBe("other");
		// And it stays out of the queue.
		const body = await expectOk<Lists>(await lists(admin));
		expect(body.queue).toEqual([]);

		// And nothing was recorded for the dropped repeat. The upsert wrote
		// nothing, so a second audit row would say a report was filed when none
		// was — in a list nothing prunes — and would spend a slot of the
		// reporter's hourly budget, which is counted out of these rows. The
		// first report's row is the one that stays.
		expect(await reportEvents(reporter)).toBe(1);
	});

	it("lets a second reporter report the same screenshot", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		const first = await makeUser();
		const second = await makeUser();
		await expectOk(await report(gameId, id, "other", first));
		await expectOk(await report(gameId, id, "not_old_world", second));

		const body = await expectOk<Lists>(await lists(admin));
		expect(body.queue[0].reports).toHaveLength(2);
	});

	it("charges the hourly ceiling on success only", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		const reporter = await makeUser();

		// A refusal writes no counter row: these rows are the reports'
		// accountability record and are never pruned, so a row per refused
		// attempt would accumulate in a list nothing cleans up.
		await expectErrorCode(
			await report(gameId, "0123456789abcdefghijk", "other", reporter),
			{ status: 404, code: "NOT_FOUND" },
		);
		expect(await reportEvents(reporter)).toBe(0);

		await expectOk(await report(gameId, id, "other", reporter));
		expect(await reportEvents(reporter)).toBe(1);
	});

	it("refuses past the hourly ceiling", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		const reporter = await makeUser();

		// Spend the budget directly — the ceiling is counted out of `events`,
		// so it is seeded rather than driven through 20 requests.
		await env.SHARE_DB.prepare(
			`INSERT INTO events (event_type, user_id)
			 WITH RECURSIVE seq(i) AS (
			   SELECT 1 UNION ALL SELECT i + 1 FROM seq WHERE i < ?
			 )
			 SELECT 'screenshot_report', ? FROM seq`,
		)
			.bind(PER_USER_SCREENSHOT_REPORTS_PER_HOUR, reporter.userId)
			.run();

		await expectErrorCode(await report(gameId, id, "other", reporter), {
			status: 429,
			code: "RATE_LIMIT_SCREENSHOT_REPORT",
		});
		expect(await reportRows(id)).toEqual([]);
	});
});

// ---------- GET /v1/admin/screenshots ----------

describe("GET /v1/admin/screenshots", () => {
	it("is dark to everyone but the site admin", async () => {
		const stranger = await makeUser();
		await expectErrorCode(await lists(), { status: 404, code: "NOT_FOUND" });
		await expectErrorCode(await lists(stranger), {
			status: 404,
			code: "NOT_FOUND",
		});
	});

	it("queues what the classifier could not decide, and names the question", async () => {
		const { user, gameId } = await readyUser();
		const queued = await uploadQueued(user, gameId);
		// A clean upload is not in the queue — nothing is waiting on it.
		await upload(user, gameId);

		const body = await expectOk<Lists>(await lists(admin));
		expect(body.queue.map((r) => r.screenshot_id)).toEqual([queued]);
		const row = body.queue[0];
		expect(row.status).toBe("in_review");
		// The stored probabilities ride along, and `tripped` re-derives which
		// band put the row here — that is why the row stores numbers rather
		// than a verdict.
		expect(row.clef.is_old_world).toBeCloseTo(0.15, 5);
		expect(row.clef.tripped).toEqual(["is_old_world"]);
		expect(row.reports).toEqual([]);
	});

	it("serves the queue oldest first", async () => {
		const { user, gameId } = await readyUser();
		const first = await uploadQueued(user, gameId);
		const second = await uploadQueued(user, gameId);

		const body = await expectOk<Lists>(await lists(admin));
		// A queue is served in the order it arrived — the opposite of the
		// galleries, which are newest-first.
		expect(body.queue.map((r) => r.screenshot_id)).toEqual([first, second]);
	});

	it("puts a reported starred screenshot in both lists, and nothing else overlaps", async () => {
		const { user, gameId } = await readyUser();
		const starred = await upload(user, gameId);
		const reporter = await makeUser();
		await expectOk(await moderate(starred, "star", admin));
		await expectOk(await report(gameId, starred, "other", reporter));

		const body = await expectOk<Lists>(await lists(admin));
		// It needs a decision AND it is on the home page. Both are true.
		expect(body.queue.map((r) => r.screenshot_id)).toEqual([starred]);
		expect(body.featured.map((r) => r.screenshot_id)).toEqual([starred]);
		expect(body.queue[0].featured_at).not.toBeNull();
	});

	it("carries both of its dates as ISO instants", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		const reporter = await makeUser();
		await expectOk(await report(gameId, id, "other", reporter));

		// The card prints both — the upload date beside the uploader, the
		// report date beside the reporter — through formatDate, which is
		// `new Date(text)`. D1's own datetime('now') text parses as LOCAL
		// time, so either one sent raw lands a day either side for any admin
		// not on UTC. Both go through isoInstantSql, like the galleries' rows.
		const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
		const row = (await expectOk<Lists>(await lists(admin))).queue[0];
		expect(row.created_at).toMatch(instant);
		expect(row.reports[0].created_at).toMatch(instant);
	});

	it("carries the game's title fields so a row can name its game", async () => {
		const { user, gameId } = await readyUser();
		await uploadQueued(user, gameId);
		const body = await expectOk<Lists>(await lists(admin));
		// Raw fields, formatted client-side by formatGameTitle — the shape the
		// profile gallery read travels in.
		expect(body.queue[0].game).toHaveProperty("game_name");
		expect(body.queue[0].game).toHaveProperty("total_turns");
		expect(body.queue[0].game_id).toBe(gameId);
	});
});

// ---------- POST /v1/admin/screenshots/:id/moderate ----------

describe("POST /v1/admin/screenshots/:screenshot_id/moderate", () => {
	it("is dark to everyone but the site admin", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		const stranger = await makeUser();

		await expectErrorCode(await moderate(id, "takedown"), {
			status: 404,
			code: "NOT_FOUND",
		});
		await expectErrorCode(await moderate(id, "takedown", stranger), {
			status: 404,
			code: "NOT_FOUND",
		});
		// The owner is not an admin here either — their route is the delete.
		await expectErrorCode(await moderate(id, "takedown", user), {
			status: 404,
			code: "NOT_FOUND",
		});
		expect(await objectKeys(gameId)).toHaveLength(1);
	});

	it("rejects an action outside the list", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		await expectErrorCode(await moderate(id, "delete_forever", admin), {
			status: 400,
			code: "INVALID_BODY",
		});
	});

	it("takes down: row, object, reports and star all in one decision", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		const reporter = await makeUser();
		await expectOk(await moderate(id, "star", admin));
		await expectOk(await report(gameId, id, "sexual_content", reporter));

		await expectOk(await moderate(id, "takedown", admin));

		// hidden_by is what distinguishes this from a classifier queue, and
		// the object is gone — which is why the distinction has to exist.
		const row = await hiddenColumns(id);
		expect(row?.hidden_at).not.toBeNull();
		expect(row?.hidden_by).toBe(admin.userId);
		expect(await objectKeys(gameId)).toHaveLength(0);
		// The star goes with it: a hidden row has no object, so a starred one
		// could only render broken on the home strip.
		const rows = await reportRows(id);
		expect(rows[0].resolved_at).not.toBeNull();

		const body = await expectOk<Lists>(await lists(admin));
		// A closed decision does not come back asking to be made again.
		expect(body.queue).toEqual([]);
		expect(body.featured).toEqual([]);
		// And no reader renders it.
		const strip = await expectOk<{ screenshots: unknown[] }>(
			await request.get({ path: `/v1/games/${gameId}/screenshots` }),
		);
		expect(strip.screenshots).toEqual([]);
	});

	it("takes down a queued screenshot too — the reject half of the queue", async () => {
		const { user, gameId } = await readyUser();
		const id = await uploadQueued(user, gameId);

		await expectOk(await moderate(id, "takedown", admin));

		const row = await hiddenColumns(id);
		expect(row?.hidden_by).toBe(admin.userId);
		expect(await objectKeys(gameId)).toHaveLength(0);
	});

	it("keeps the first takedown's decision on a repeat", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		await expectOk(await moderate(id, "takedown", admin));
		const first = await hiddenColumns(id);

		// Repeatable rather than a 409: re-running is the only recovery a
		// half-failed purge has, since the purge logs instead of throwing.
		await expectOk(await moderate(id, "takedown", admin));
		const second = await hiddenColumns(id);
		expect(second?.hidden_at).toBe(first?.hidden_at);
		expect(second?.hidden_by).toBe(first?.hidden_by);
	});

	it("approves a queued screenshot, which publishes it", async () => {
		const { user, gameId } = await readyUser();
		const id = await uploadQueued(user, gameId);
		// The object was kept, which is what makes this possible at all.
		expect(await objectKeys(gameId)).toHaveLength(1);

		await expectOk(await moderate(id, "approve", admin));

		const row = await hiddenColumns(id);
		expect(row?.hidden_at).toBeNull();
		const strip = await expectOk<{ screenshots: { screenshot_id: string }[] }>(
			await request.get({ path: `/v1/games/${gameId}/screenshots` }),
		);
		expect(strip.screenshots.map((s) => s.screenshot_id)).toEqual([id]);
		// Out of the queue: there is nothing left to decide.
		const body = await expectOk<Lists>(await lists(admin));
		expect(body.queue).toEqual([]);
	});

	it("refuses to approve what an admin took down, because the image is gone", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		await expectOk(await moderate(id, "takedown", admin));

		// The whole reason `hidden_by` exists: clearing the column here would
		// publish a row whose tile and lightbox both 404.
		await expectErrorCode(await moderate(id, "approve", admin), {
			status: 409,
			code: "OBJECT_REMOVED",
		});
		const row = await hiddenColumns(id);
		expect(row?.hidden_at).not.toBeNull();
		expect(row?.hidden_by).toBe(admin.userId);
	});

	it("stars and unstars a published screenshot, keeping the first timestamp", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);

		await expectOk(await moderate(id, "star", admin));
		const first = await expectOk<Lists>(await lists(admin));
		expect(first.featured.map((r) => r.screenshot_id)).toEqual([id]);
		const featuredAt = first.featured[0].featured_at;

		// Re-starring keeps the timestamp the home strip orders by rather than
		// jumping the row to the front of its own strip.
		await expectOk(await moderate(id, "star", admin));
		const again = await expectOk<Lists>(await lists(admin));
		expect(again.featured[0].featured_at).toBe(featuredAt);

		await expectOk(await moderate(id, "unstar", admin));
		const after = await expectOk<Lists>(await lists(admin));
		expect(after.featured).toEqual([]);
	});

	it("refuses to star a hidden screenshot", async () => {
		const { user, gameId } = await readyUser();
		const queued = await uploadQueued(user, gameId);
		await expectErrorCode(await moderate(queued, "star", admin), {
			status: 409,
			code: "SCREENSHOT_HIDDEN",
		});

		const hidden = await upload(user, gameId);
		await expectOk(await moderate(hidden, "takedown", admin));
		await expectErrorCode(await moderate(hidden, "star", admin), {
			status: 409,
			code: "SCREENSHOT_HIDDEN",
		});
	});

	it("resolves the reports and leaves the image up", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		const reporter = await makeUser();
		await expectOk(await report(gameId, id, "not_old_world", reporter));

		await expectOk(await moderate(id, "resolve_reports", admin));

		const rows = await reportRows(id);
		expect(rows[0].resolved_at).not.toBeNull();
		// Still served, and out of the queue.
		expect(await objectKeys(gameId)).toHaveLength(1);
		const body = await expectOk<Lists>(await lists(admin));
		expect(body.queue).toEqual([]);
		const strip = await expectOk<{ screenshots: { screenshot_id: string }[] }>(
			await request.get({ path: `/v1/games/${gameId}/screenshots` }),
		);
		expect(strip.screenshots.map((s) => s.screenshot_id)).toEqual([id]);
	});

	it("404s an unknown screenshot", async () => {
		await expectErrorCode(
			await moderate("0123456789abcdefghijk", "takedown", admin),
			{ status: 404, code: "NOT_FOUND" },
		);
	});

	it("writes a screenshot_moderate audit row naming the action", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		await expectOk(await moderate(id, "star", admin));

		const row = await env.SHARE_DB.prepare(
			`SELECT user_id, metadata FROM events
			 WHERE event_type = 'screenshot_moderate'`,
		).first<{ user_id: string; metadata: string }>();
		expect(row?.user_id).toBe(admin.userId);
		const metadata = JSON.parse(row?.metadata ?? "{}") as {
			screenshot_id: string;
			game_id: string;
			action: string;
		};
		expect(metadata.screenshot_id).toBe(id);
		expect(metadata.game_id).toBe(gameId);
		expect(metadata.action).toBe("star");
	});
});

// ---------- What a takedown releases, and what a queued row keeps ----------

// The two guards that count stored screenshots, against the distinction
// `hidden_by` draws. A taken-down row has no object, so it holds no slot and
// pins nothing; a queued row's object IS in R2 and public, so it holds both —
// which is why the galleries show a queued row to its uploader, and why they
// show a taken-down one to nobody.
describe("the storage guards and the two hidden states", () => {
	it("releases the game's slot that the taken-down row was holding", async () => {
		const { user, gameId } = await readyUser();
		const ids: string[] = [];
		for (let i = 0; i < MAX_SCREENSHOTS_PER_GAME; i++) {
			ids.push(await upload(user, gameId));
		}
		await expectErrorCode(
			await postMultipart({
				path: `/v1/games/${gameId}/screenshots`,
				form: screenshotForm(),
				as: user,
			}),
			{ status: 409, code: "GAME_SCREENSHOT_LIMIT" },
		);

		await expectOk(await moderate(ids[0], "takedown", admin));

		// The row is still there — it is the moderation record — and the slot
		// is free, because the object it was holding is gone.
		expect(await hiddenColumns(ids[0])).not.toBeNull();
		const replacement = await upload(user, gameId);
		expect(replacement).toBeTruthy();
	});

	it("lets the game be made private again once nothing public is left", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		const makePrivate = (): Promise<Response> =>
			request.patch({
				path: `/v1/games/${gameId}`,
				as: user,
				body: { is_public: false },
			});

		await expectErrorCode(await makePrivate(), {
			status: 409,
			code: "HAS_SCREENSHOTS",
		});

		await expectOk(await moderate(id, "takedown", admin));
		await expectOk(await makePrivate());
	});

	it("keeps both while the row is only queued, which the owner can see", async () => {
		const { user, gameId } = await readyUser();
		const queued = await uploadQueued(user, gameId);

		// Its object is public — unlinked, ungated — so the game stays public.
		await expectErrorCode(
			await request.patch({
				path: `/v1/games/${gameId}`,
				as: user,
				body: { is_public: false },
			}),
			{ status: 409, code: "HAS_SCREENSHOTS" },
		);
		// And the owner is sent the row, so the remedy that refusal names has
		// a tile to be pressed on.
		const strip = await expectOk<{
			screenshots: { screenshot_id: string; status: string }[];
		}>(
			await request.get({ path: `/v1/games/${gameId}/screenshots`, as: user }),
		);
		expect(strip.screenshots).toEqual([
			expect.objectContaining({ screenshot_id: queued, status: "in_review" }),
		]);

		// Pressed: the row goes, and the game can be made private.
		await expectOk(
			await request.delete({
				path: `/v1/games/${gameId}/screenshots/${queued}`,
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
	});
});

// ---------- The owner's delete, against a reported screenshot ----------

describe("DELETE /v1/games/:id/screenshots/:screenshot_id with reports", () => {
	it("takes the open reports with it", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		const reporter = await makeUser();
		await expectOk(await report(gameId, id, "other", reporter));

		await expectOk(
			await request.delete({
				path: `/v1/games/${gameId}/screenshots/${id}`,
				as: user,
			}),
		);

		// The ON DELETE CASCADE from migration 0050 — the report has nothing
		// left to be about, and the queue must not hold a row whose screenshot
		// is gone. The `screenshot_report` event is the durable record.
		expect(await reportRows(id)).toEqual([]);
		const body = await expectOk<Lists>(await lists(admin));
		expect(body.queue).toEqual([]);
	});
});
