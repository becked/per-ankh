// The curated home strip (issue #289, step 7): GET /v1/featured-screenshots.
//
// What this read is, and what is therefore worth pinning: the admin-starred
// set and nothing else, newest star first, the same bytes for every viewer.
// That last property is not cosmetic — the response is shared-cacheable for a
// minute, so a viewer-dependent leg of the kind both galleries carry would be
// served to the wrong person. There is no session read here at all, and the
// tests below call the endpoint anonymously for that reason.
//
// The star is set through the real moderation endpoint rather than by writing
// the column, so what these tests read is what an admin pressing "Star for
// home" actually produces. `featured_at` is set by datetime('now') at
// one-second resolution, though, so the two cases that are ABOUT the order
// write distinct timestamps directly — otherwise every row in a test ties and
// the assertion would be about the rowid tiebreak instead.
//
// The Clef call is stubbed as in gallery.test.ts: these tests need stored
// rows, not a classifier verdict.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectOk } from "../../helpers/assertions";
import { makeSiteAdmin, makeUser, type TestUser } from "../../helpers/builders";
import { seedGame } from "../../helpers/games";
import { postMultipart, request } from "../../helpers/requests";
import { screenshotForm } from "../../helpers/screenshot-image";
import { SCORE_ID } from "../../../src/screenshots/clef";
import { MAX_FEATURED_SCREENSHOTS } from "../../../src/screenshots/handlers";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	admin = await makeSiteAdmin();
});

// One site admin for the file: users.discord_id is unique and the Worker
// recognizes exactly one.
let admin: TestUser;

// ---------- The stubbed classifier ----------

const CLEAN: Record<string, number> = {
	is_old_world: 0.8,
	contains_nsfw: 0.02,
	contains_gore: 0.03,
	is_a_photograph: 0.03,
};

function clefResponse(nouls: Record<string, number>): Record<string, unknown> {
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
	(env as unknown as { AI: unknown }).AI = {
		run: async () => clefResponse(CLEAN),
	};
	// Every case asserts on the whole strip, so each starts from an empty one.
	await env.SHARE_DB.prepare("DELETE FROM game_screenshots").run();
});

// ---------- Fixtures ----------

interface StripRow {
	screenshot_id: string;
	game_id: string;
	url: string;
	thumb_url: string;
	width: number;
	height: number;
	caption: string | null;
	status: "published" | "in_review";
	game: {
		game_name: string | null;
		display_name: string | null;
		user_nation: string | null;
		total_turns: number | null;
	};
	uploader: {
		user_id: string;
		display_name: string;
		slug: string | null;
		avatar_url: string;
	};
}

async function readyUser(
	displayName?: string,
): Promise<{ user: TestUser; gameId: string }> {
	const user = await makeUser(
		displayName === undefined ? undefined : { displayName },
	);
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

function star(screenshotId: string): Promise<Response> {
	return request.post({
		path: `/v1/admin/screenshots/${screenshotId}/moderate`,
		as: admin,
		body: { action: "star" },
	});
}

// Anonymous, always: the strip takes no session, and a test that sent one
// would stop testing what the edge cache is allowed to hold.
function strip(): Promise<Response> {
	return request.get({ path: "/v1/featured-screenshots" });
}

async function stripIds(): Promise<string[]> {
	const body = await expectOk<{ screenshots: StripRow[] }>(await strip());
	return body.screenshots.map((s) => s.screenshot_id);
}

// The one column the tests about ordering can't get from the clock: two stars
// pressed in the same second tie on featured_at, and the tiebreak behind it is
// upload order rather than star order.
async function setStarredAt(
	screenshotId: string,
	featuredAt: string,
): Promise<void> {
	await env.SHARE_DB.prepare(
		"UPDATE game_screenshots SET featured_at = ? WHERE screenshot_id = ?",
	)
		.bind(featuredAt, screenshotId)
		.run();
}

// ---------- GET /v1/featured-screenshots ----------

describe("GET /v1/featured-screenshots", () => {
	it("serves only the starred shots, to anyone, with both URLs", async () => {
		const { user, gameId } = await readyUser();
		const starred = await upload(user, gameId, "Late empire");
		const plain = await upload(user, gameId);

		await expectOk(await star(starred));

		const body = await expectOk<{ screenshots: StripRow[] }>(await strip());
		expect(body.screenshots.map((s) => s.screenshot_id)).toEqual([starred]);
		const shot = body.screenshots[0];
		expect(shot.caption).toBe("Late empire");
		expect(shot.status).toBe("published");
		// The stored object and the one transformation of it, built from
		// SCREENSHOT_BASE_URL and the key — never assembled by the client.
		expect(shot.url).toBe(
			`${env.SCREENSHOT_BASE_URL}/screenshots/${gameId}/${starred}.webp`,
		);
		expect(shot.thumb_url).toContain("/cdn-cgi/image/");
		expect(
			shot.thumb_url.endsWith(`/screenshots/${gameId}/${starred}.webp`),
		).toBe(true);
		// Both galleries would have served `plain` as well; only the star reaches
		// the home page.
		expect(body.screenshots.map((s) => s.screenshot_id)).not.toContain(plain);
	});

	it("names the game and credits the uploader", async () => {
		const { user, gameId } = await readyUser("Hatshepsut");
		const id = await upload(user, gameId);
		await expectOk(await star(id));

		const body = await expectOk<{ screenshots: StripRow[] }>(await strip());
		const shot = body.screenshots[0];
		expect(shot.game_id).toBe(gameId);
		// The raw title fields travel; formatGameTitle renders them client-side,
		// as on the profile tab.
		expect(shot.game.total_turns).not.toBeNull();
		expect(shot.uploader.user_id).toBe(user.userId);
		expect(shot.uploader.display_name).toBe("Hatshepsut");
		expect(shot.uploader.avatar_url).toContain("cdn.discordapp.com");
	});

	it("reflects a rename, because identity is joined and not snapshotted", async () => {
		const { user, gameId } = await readyUser("Old Name");
		const id = await upload(user, gameId);
		await expectOk(await star(id));

		await env.SHARE_DB.prepare(
			"UPDATE users SET display_name = ? WHERE user_id = ?",
		)
			.bind("New Name", user.userId)
			.run();

		const body = await expectOk<{ screenshots: StripRow[] }>(await strip());
		expect(body.screenshots[0].uploader.display_name).toBe("New Name");
	});

	it("orders by when the star was given, newest first", async () => {
		const { user, gameId } = await readyUser();
		const first = await upload(user, gameId);
		const second = await upload(user, gameId);
		await expectOk(await star(first));
		await expectOk(await star(second));

		// Starred second-upload-first, so a read that ordered by upload time, or
		// leaned on the rowid tiebreak, would answer the other way round.
		await setStarredAt(second, "2026-01-01 00:00:00");
		await setStarredAt(first, "2026-02-01 00:00:00");

		expect(await stripIds()).toEqual([first, second]);
	});

	it("caps the strip, keeping the newest stars", async () => {
		const { user, gameId } = await readyUser();
		// Past the cap, and past the 5-per-game cap too, so the rows come from
		// more than one game — which is what the strip spans.
		const ids: string[] = [];
		for (let i = 0; i < MAX_FEATURED_SCREENSHOTS + 1; i++) {
			const game = i < 3 ? gameId : await seedGame(user, { isPublic: true });
			const id = await upload(user, game);
			await expectOk(await star(id));
			// Oldest star first, so the one left out is `ids[0]`.
			await setStarredAt(id, `2026-01-0${i + 1} 00:00:00`);
			ids.push(id);
		}

		const served = await stripIds();
		expect(served).toHaveLength(MAX_FEATURED_SCREENSHOTS);
		expect(served).toEqual(
			[...ids].reverse().slice(0, MAX_FEATURED_SCREENSHOTS),
		);
		expect(served).not.toContain(ids[0]);
	});

	it("drops a screenshot hidden out from under its star", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		await expectOk(await star(id));
		expect(await stripIds()).toEqual([id]);

		// The moderation endpoint can't produce this state — a takedown clears the
		// star on its way past — and that is the point: the strip filters on
		// hidden_at itself rather than trusting every writer of it to also clear
		// the star.
		await env.SHARE_DB.prepare(
			"UPDATE game_screenshots SET hidden_at = datetime('now') WHERE screenshot_id = ?",
		)
			.bind(id)
			.run();

		expect(await stripIds()).toEqual([]);
	});

	it("leaves the strip when an admin takes the screenshot down", async () => {
		const { user, gameId } = await readyUser();
		const id = await upload(user, gameId);
		await expectOk(await star(id));

		await expectOk(
			await request.post({
				path: `/v1/admin/screenshots/${id}/moderate`,
				as: admin,
				body: { action: "takedown" },
			}),
		);

		expect(await stripIds()).toEqual([]);
	});

	it("answers an empty strip when nothing is starred", async () => {
		const { user, gameId } = await readyUser();
		await upload(user, gameId);

		expect(await stripIds()).toEqual([]);
	});

	it("is shared-cacheable for a minute and varies only on Origin", async () => {
		const res = await strip();
		await expectOk(res);
		// What makes this safe is the absence of a session read above: the same
		// bytes for every viewer, so an edge copy can serve all of them. No
		// browser cache, so a new star shows up on reload.
		expect(res.headers.get("Cache-Control")).toBe(
			"public, max-age=0, s-maxage=60",
		);
		expect(res.headers.get("Vary")).toBe("Origin");
	});
});
