// Integration tests for the owner-featured videos endpoints — the list, the
// validated upsert, the idempotent delete, and the public profile read they
// reorder (cloud/src/channels.ts).
//
// The ordering rule itself is unit-tested beside the source (featuredFirst in
// channels.test.ts). What only an isolate can pin is the handler: that the
// write refuses a video that isn't one of the caller's own uploads, that the
// snapshot it stores comes from the channel feed rather than from the body,
// that an anonymous visitor gets the owner's picks at the front of the tab, and
// that a featured video outlives the feed it came from.
//
// Videos reach the handler the way the profile read gets them — out of the SWR
// cache in KV, seeded here under the cache module's own cacheKey so a
// CACHE_VERSION bump moves the seed instead of orphaning it. `fetched_at` is
// now, so nothing in these tests is stale enough to attempt a YouTube fetch.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeUser, type TestUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";
import { cacheKey } from "../../../src/video/cache";

const PATH = "/v1/auth/featured-videos";
const CREATOR_CHANNEL = "UCcreatorchannelid00000";
const OTHER_CHANNEL = "UCotherchannelid000000";

// The profile whose Videos tab these tests read, and a second creator with a
// channel of their own — the one case that proves the write checks whose upload
// a video is, not merely that it exists somewhere.
let creator: TestUser;
let other: TestUser;

function video(opts: {
	id: string;
	title: string;
	published_at: string;
}): Record<string, unknown> {
	return {
		id: opts.id,
		title: opts.title,
		url: `https://www.youtube.com/watch?v=${opts.id}`,
		thumbnail_url: `https://i.ytimg.com/vi/${opts.id}/hqdefault.jpg`,
		published_at: opts.published_at,
		platform: "youtube",
		duration_seconds: 1800,
	};
}

/** Seed the SWR entry the handlers read, under the key the cache reads. */
async function seedChannel(
	channelId: string,
	videos: Record<string, unknown>[],
): Promise<void> {
	await env.SESSIONS_KV.put(
		cacheKey("youtube", channelId),
		JSON.stringify({ fetched_at: Date.now(), videos }),
	);
}

const NEWEST = video({
	id: "vidnewest01",
	title: "Old World — Assyria, turn 1",
	published_at: "2026-07-03T12:00:00Z",
});
const MIDDLE = video({
	id: "vidmiddle01",
	title: "Old World — Rome, the long game",
	published_at: "2026-07-02T12:00:00Z",
});
const OLDEST = video({
	id: "vidoldest01",
	title: "Old World — Egypt, a Nile start",
	published_at: "2026-07-01T12:00:00Z",
});

interface VideosBody {
	videos: {
		id: string;
		title: string;
		url: string;
		thumbnail_url: string | null;
		published_at: string;
		platform: string;
		duration_seconds: number | null;
		user_id?: string;
		display_name?: string;
		slug?: string | null;
		avatar_url?: string;
	}[];
}

async function myFeatured(as: TestUser): Promise<VideosBody> {
	return expectOk<VideosBody>(await request.get({ path: PATH, as }));
}

async function profileVideos(userId: string): Promise<VideosBody> {
	return expectOk<VideosBody>(
		// No `as`: the public read, exactly as a signed-out visitor makes it.
		await request.get({ path: `/v1/users/${userId}/videos` }),
	);
}

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	creator = await makeUser({ displayName: "Featured Creator" });
	other = await makeUser({ displayName: "Other Creator" });
	// A Discord avatar hash so the read's avatar_url is the per-user CDN path
	// rather than the hashless default, which is the same for everyone and
	// would prove nothing about the identity join.
	await env.SHARE_DB.prepare(
		"UPDATE users SET avatar_hash = ? WHERE user_id = ?",
	)
		.bind("abc123", creator.userId)
		.run();
	for (const [user, channel] of [
		[creator, CREATOR_CHANNEL],
		[other, OTHER_CHANNEL],
	] as const) {
		await env.SHARE_DB.prepare(
			`INSERT INTO user_video_channels (user_id, platform, channel_url, channel_id)
			 VALUES (?, 'youtube', ?, ?)`,
		)
			.bind(user.userId, `https://www.youtube.com/channel/${channel}`, channel)
			.run();
	}
});

// Every case here asserts on a whole set, so start each from an empty table and
// the same three-video feed rather than threading unique ids through cases that
// are about ordering and counts.
beforeEach(async () => {
	await env.SHARE_DB.prepare("DELETE FROM user_featured_videos").run();
	await seedChannel(CREATOR_CHANNEL, [NEWEST, MIDDLE, OLDEST]);
	await seedChannel(OTHER_CHANNEL, [
		video({
			id: "vidothers01",
			title: "Old World — someone else's upload",
			published_at: "2026-07-04T12:00:00Z",
		}),
	]);
});

describe("POST /v1/auth/featured-videos", () => {
	it("requires a session", async () => {
		await expectErrorCode(
			await request.post({
				path: PATH,
				body: { platform: "youtube", video_id: OLDEST.id },
			}),
			{ status: 401, code: "UNAUTHORIZED" },
		);
	});

	it("stores a snapshot taken from the channel feed, not from the body", async () => {
		await expectOk(
			await request.post({
				path: PATH,
				as: creator,
				// A caller's own title and URL are ignored: the row renders on a
				// public profile under their name, so the platform's fields are the
				// only ones that reach it.
				body: {
					platform: "youtube",
					video_id: OLDEST.id,
					title: "Totally different title",
					url: "https://example.test/not-a-youtube-url",
				},
			}),
		);

		const { videos } = await myFeatured(creator);
		expect(videos).toHaveLength(1);
		expect(videos[0]).toMatchObject({
			id: OLDEST.id,
			title: OLDEST.title,
			url: OLDEST.url,
			thumbnail_url: OLDEST.thumbnail_url,
			published_at: OLDEST.published_at,
			platform: "youtube",
			// The table has no duration column, so a featured row is null here
			// even though the feed entry it was taken from carried a runtime.
			duration_seconds: null,
			// Identity is joined live, not snapshotted.
			user_id: creator.userId,
			display_name: "Featured Creator",
		});
		expect(videos[0].avatar_url).toContain("abc123");
	});

	it("refuses a video that is in nobody's channel", async () => {
		await expectErrorCode(
			await request.post({
				path: PATH,
				as: creator,
				body: { platform: "youtube", video_id: "notaupload1" },
			}),
			{ status: 400, code: "VIDEO_NOT_IN_CHANNELS" },
		);
		expect((await myFeatured(creator)).videos).toHaveLength(0);
	});

	it("refuses another creator's upload", async () => {
		// The check is whose upload it is, not whether the video exists: this one
		// is in the other creator's feed, and would be featurable by them.
		await expectErrorCode(
			await request.post({
				path: PATH,
				as: creator,
				body: { platform: "youtube", video_id: "vidothers01" },
			}),
			{ status: 400, code: "VIDEO_NOT_IN_CHANNELS" },
		);
		expect((await myFeatured(creator)).videos).toHaveLength(0);
	});

	it("refreshes the snapshot when the same video is featured twice", async () => {
		const body = { platform: "youtube", video_id: OLDEST.id };
		await expectOk(await request.post({ path: PATH, as: creator, body }));

		// The video is re-titled on YouTube and the feed refreshes.
		const retitled = {
			...OLDEST,
			title: "Old World — Egypt, a Nile start (remastered)",
		};
		await seedChannel(CREATOR_CHANNEL, [NEWEST, MIDDLE, retitled]);
		await expectOk(await request.post({ path: PATH, as: creator, body }));

		const { videos } = await myFeatured(creator);
		expect(videos).toHaveLength(1);
		expect(videos[0].title).toBe(retitled.title);
	});
});

describe("GET /v1/auth/featured-videos", () => {
	it("requires a session", async () => {
		await expectErrorCode(await request.get({ path: PATH }), {
			status: 401,
			code: "UNAUTHORIZED",
		});
	});

	it("lists only the caller's own set, newest first", async () => {
		for (const id of [OLDEST.id, NEWEST.id]) {
			await expectOk(
				await request.post({
					path: PATH,
					as: creator,
					body: { platform: "youtube", video_id: id },
				}),
			);
		}
		await expectOk(
			await request.post({
				path: PATH,
				as: other,
				body: { platform: "youtube", video_id: "vidothers01" },
			}),
		);

		expect((await myFeatured(creator)).videos.map((v) => v.id)).toEqual([
			NEWEST.id,
			OLDEST.id,
		]);
		expect((await myFeatured(other)).videos.map((v) => v.id)).toEqual([
			"vidothers01",
		]);
	});
});

describe("DELETE /v1/auth/featured-videos/:platform/:video_id", () => {
	it("unfeatures, and stays successful when the row is already gone", async () => {
		await expectOk(
			await request.post({
				path: PATH,
				as: creator,
				body: { platform: "youtube", video_id: OLDEST.id },
			}),
		);
		const path = `${PATH}/youtube/${OLDEST.id}`;
		await expectOk(await request.delete({ path, as: creator }));
		expect((await myFeatured(creator)).videos).toHaveLength(0);
		// Idempotent: the pin on a card and the Featured tab's Remove can both
		// reach a row, and neither has to know which got there first.
		await expectOk(await request.delete({ path, as: creator }));
	});

	it("requires a session", async () => {
		await expectErrorCode(
			await request.delete({ path: `${PATH}/youtube/${OLDEST.id}` }),
			{ status: 401, code: "UNAUTHORIZED" },
		);
	});

	it("cannot reach another creator's row", async () => {
		await expectOk(
			await request.post({
				path: PATH,
				as: creator,
				body: { platform: "youtube", video_id: OLDEST.id },
			}),
		);
		// Idempotent, so this succeeds — but it deletes nothing, because the
		// statement is scoped to the caller's own user_id.
		await expectOk(
			await request.delete({ path: `${PATH}/youtube/${OLDEST.id}`, as: other }),
		);
		expect((await myFeatured(creator)).videos).toHaveLength(1);
	});
});

describe("GET /v1/users/:user_id/videos", () => {
	it("leads with the owner's featured videos for an anonymous visitor", async () => {
		// The oldest upload of the three — so the only way it can come out first
		// is the promotion, not the date sort.
		await expectOk(
			await request.post({
				path: PATH,
				as: creator,
				body: { platform: "youtube", video_id: OLDEST.id },
			}),
		);

		const { videos } = await profileVideos(creator.userId);
		expect(videos.map((v) => v.id)).toEqual([OLDEST.id, NEWEST.id, MIDDLE.id]);
	});

	it("is newest-first when nothing is featured", async () => {
		const { videos } = await profileVideos(creator.userId);
		expect(videos.map((v) => v.id)).toEqual([NEWEST.id, MIDDLE.id, OLDEST.id]);
	});

	it("keeps a featured video after it drops out of the channel feed", async () => {
		await expectOk(
			await request.post({
				path: PATH,
				as: creator,
				body: { platform: "youtube", video_id: OLDEST.id },
			}),
		);
		// The feed moves on — a channel's RSS carries ~15 entries, so the video
		// the owner promoted is the first to leave it. The stored snapshot is
		// what keeps it on the tab.
		await seedChannel(CREATOR_CHANNEL, [NEWEST, MIDDLE]);

		const { videos } = await profileVideos(creator.userId);
		expect(videos.map((v) => v.id)).toEqual([OLDEST.id, NEWEST.id, MIDDLE.id]);
		expect(videos[0].title).toBe(OLDEST.title);
	});

	it("renders the featured video once, not twice", async () => {
		// Same (platform, video_id) in both halves: two entries sharing a key
		// crash the tab's keyed {#each} with each_key_duplicate.
		await expectOk(
			await request.post({
				path: PATH,
				as: creator,
				body: { platform: "youtube", video_id: NEWEST.id },
			}),
		);
		const { videos } = await profileVideos(creator.userId);
		expect(videos.filter((v) => v.id === NEWEST.id)).toHaveLength(1);
		expect(videos).toHaveLength(3);
	});
});
