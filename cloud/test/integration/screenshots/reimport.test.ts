// A re-import keeps the game's screenshots.
//
// The games row is written with INSERT OR REPLACE on a re-import, and REPLACE
// resolves the primary-key conflict by deleting the old row — which cascades
// through game_screenshots.game_id and on through
// screenshot_reports.screenshot_id. Both tables are restored from inside the
// same batch (cloud/src/screenshots/reimport.ts); without that, reparsing a
// save emptied its gallery and left every object in R2 orphaned and still
// public.
//
// The rows are seeded rather than uploaded: what is under test is the restore,
// and a seeded row spends the cascade exactly as a stored one does, while
// letting one fixture carry all four states — published, starred, queued,
// taken down — plus an open and a resolved report. The classifier is never
// reached, so there is no `env.AI` stub here.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../helpers/assertions";
import { makeUser, type TestUser } from "../../helpers/builders";
import { postMultipart, request } from "../../helpers/requests";
import { buildUploadFormData } from "../../helpers/save-blob";
import { screenshotKey } from "../../../src/screenshots/storage";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

// ---------- Fixtures ----------

// The ZIP bytes are what dedup matches on, so a re-import is the same nonce at
// a higher parser_version — the shape the tournament re-link test uses.
async function upload(
	user: TestUser,
	nonce: string,
	parserVersion?: string,
): Promise<{ game_id: string; reimported?: boolean }> {
	const form = await buildUploadFormData({
		winnerIndex: 0,
		uploaderIndex: 0,
		nonce,
		parserVersion,
	});
	return expectOk<{ game_id: string; reimported?: boolean }>(
		await postMultipart({ path: "/v1/games", form, as: user }),
	);
}

interface SeedOpts {
	readonly caption?: string;
	readonly featuredBy?: TestUser;
	readonly hiddenAt?: boolean;
	readonly hiddenBy?: TestUser;
}

async function seedScreenshot(
	gameId: string,
	owner: TestUser,
	screenshotId: string,
	opts: SeedOpts = {},
): Promise<string> {
	await env.SHARE_DB.prepare(
		`INSERT INTO game_screenshots
		   (screenshot_id, game_id, user_id, r2_key, width, height, size_bytes,
		    caption, is_old_world, contains_nsfw, contains_gore,
		    is_a_photograph, game_screenshot_confidence,
		    game_screenshot_probabilities, featured_at, featured_by,
		    hidden_at, hidden_by)
		 VALUES (?, ?, ?, ?, 1920, 1080, 204800, ?,
		         0.82, 0.02, 0.03, 0.04, 3.6, '{"4":0.6}',
		         CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END, ?,
		         CASE WHEN ? = 1 THEN datetime('now') END, ?)`,
	)
		.bind(
			screenshotId,
			gameId,
			owner.userId,
			screenshotKey(gameId, screenshotId),
			opts.caption ?? null,
			opts.featuredBy?.userId ?? null,
			opts.featuredBy?.userId ?? null,
			opts.hiddenAt || opts.hiddenBy ? 1 : 0,
			opts.hiddenBy?.userId ?? null,
		)
		.run();
	return screenshotId;
}

async function seedReport(
	screenshotId: string,
	reporter: TestUser,
	resolvedBy?: TestUser,
): Promise<void> {
	await env.SHARE_DB.prepare(
		`INSERT INTO screenshot_reports
		   (screenshot_id, reporter_user_id, reason, resolved_at, resolved_by)
		 VALUES (?, ?, 'not_old_world',
		         CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END, ?)`,
	)
		.bind(
			screenshotId,
			reporter.userId,
			resolvedBy?.userId ?? null,
			resolvedBy?.userId ?? null,
		)
		.run();
}

// `SELECT *` on purpose: the restore writes every column, so a column added to
// either table is compared here without this file being touched.
function screenshotRows(gameId: string): Promise<Record<string, unknown>[]> {
	return env.SHARE_DB.prepare(
		"SELECT * FROM game_screenshots WHERE game_id = ? ORDER BY screenshot_id",
	)
		.bind(gameId)
		.all<Record<string, unknown>>()
		.then((r) => r.results ?? []);
}

function reportRows(gameId: string): Promise<Record<string, unknown>[]> {
	return env.SHARE_DB.prepare(
		`SELECT r.* FROM screenshot_reports r
		 JOIN game_screenshots s ON s.screenshot_id = r.screenshot_id
		 WHERE s.game_id = ?
		 ORDER BY r.screenshot_id, r.reporter_user_id`,
	)
		.bind(gameId)
		.all<Record<string, unknown>>()
		.then((r) => r.results ?? []);
}

interface GalleryBody {
	screenshots: { screenshot_id: string; featured: boolean; status: string }[];
}

describe("re-import of a game with screenshots", () => {
	it("restores every row and every report verbatim", async () => {
		const owner = await makeUser({ discordUsername: "shot-owner" });
		const admin = await makeUser({ discordUsername: "shot-admin" });
		const reporter = await makeUser({ discordUsername: "shot-reporter" });
		const nonce = "reimport-screenshots-fixture";
		const first = await upload(owner, nonce);

		// All four states one row can be in, since each is lost the same way
		// and means something different: a published row is the gallery, a
		// starred one is the home strip, a queued one holds a quota slot and
		// pins the game public, and a taken-down one is a closed decision the
		// admin queue must not be asked again.
		const published = await seedScreenshot(
			first.game_id,
			owner,
			"shot-published-00000",
			{ caption: "The second city" },
		);
		await seedScreenshot(first.game_id, owner, "shot-starred-000000", {
			featuredBy: admin,
		});
		await seedScreenshot(first.game_id, owner, "shot-queued-0000000", {
			hiddenAt: true,
		});
		const takenDown = await seedScreenshot(
			first.game_id,
			owner,
			"shot-takendown-00000",
			{ hiddenBy: admin },
		);
		await seedReport(published, reporter);
		await seedReport(takenDown, reporter, admin);

		const screenshotsBefore = await screenshotRows(first.game_id);
		const reportsBefore = await reportRows(first.game_id);
		expect(screenshotsBefore).toHaveLength(4);
		expect(reportsBefore).toHaveLength(2);

		const again = await upload(owner, nonce, "2.4.1");
		expect(again.game_id).toBe(first.game_id);
		expect(again.reimported).toBe(true);

		expect(await screenshotRows(first.game_id)).toEqual(screenshotsBefore);
		expect(await reportRows(first.game_id)).toEqual(reportsBefore);
	});

	it("leaves the gallery reading exactly as it did before the reparse", async () => {
		const owner = await makeUser({ discordUsername: "gallery-owner" });
		const admin = await makeUser({ discordUsername: "gallery-admin" });
		const nonce = "reimport-gallery-fixture";
		const first = await upload(owner, nonce);
		await seedScreenshot(first.game_id, owner, "gallery-published-000", {
			caption: "Chariots",
		});
		await seedScreenshot(first.game_id, owner, "gallery-starred-0000", {
			featuredBy: admin,
		});

		const path = `/v1/games/${first.game_id}/screenshots`;
		const before = await expectOk<GalleryBody>(await request.get({ path }));

		const again = await upload(owner, nonce, "2.4.1");
		expect(again.reimported).toBe(true);

		const after = await expectOk<GalleryBody>(await request.get({ path }));
		expect(after.screenshots).toEqual(before.screenshots);
		expect(after.screenshots).toHaveLength(2);
	});

	it("still re-imports a game that has none", async () => {
		const owner = await makeUser({ discordUsername: "no-shots" });
		const nonce = "reimport-no-screenshots";
		const first = await upload(owner, nonce);
		const again = await upload(owner, nonce, "2.4.1");
		expect(again.game_id).toBe(first.game_id);
		expect(again.reimported).toBe(true);
		expect(await screenshotRows(first.game_id)).toEqual([]);
	});
});
