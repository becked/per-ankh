import { describe, expect, it } from "vitest";
import { featuredFirst, type CreatorVideo, mergeCreatorFeed } from "./channels";

// A CreatorVideo with sensible defaults — override only what a case cares
// about. The default title names Old World so ordering/cap/attribution cases
// aren't also exercising the feed's title filter; the filter has its own.
function vid(
	over: Partial<CreatorVideo> & { id: string; published_at: string },
): CreatorVideo {
	return {
		title: `Old World video ${over.id}`,
		url: `https://youtu.be/${over.id}`,
		thumbnail_url: null,
		platform: "youtube",
		duration_seconds: null,
		user_id: "u1",
		display_name: "Creator One",
		slug: null,
		avatar_url: "https://example.test/a.png",
		...over,
	};
}

describe("mergeCreatorFeed", () => {
	it("orders newest-first across creators", () => {
		const a = [
			vid({ id: "a1", published_at: "2026-01-10T00:00:00Z", user_id: "a" }),
			vid({ id: "a2", published_at: "2026-01-01T00:00:00Z", user_id: "a" }),
		];
		const b = [
			vid({ id: "b1", published_at: "2026-01-05T00:00:00Z", user_id: "b" }),
		];
		expect(mergeCreatorFeed([a, b]).map((v) => v.id)).toEqual([
			"a1",
			"b1",
			"a2",
		]);
	});

	it("keeps multiple videos from the same creator", () => {
		const a = [
			vid({ id: "a1", published_at: "2026-01-10T00:00:00Z", user_id: "a" }),
			vid({ id: "a2", published_at: "2026-01-09T00:00:00Z", user_id: "a" }),
		];
		expect(mergeCreatorFeed([a, []]).map((v) => v.id)).toEqual(["a1", "a2"]);
	});

	it("caps the merged feed to the default size, newest kept", () => {
		// Descending timestamps → v0 newest, v19 oldest.
		const many = Array.from({ length: 20 }, (_, i) =>
			vid({
				id: `v${i}`,
				published_at: `2026-01-${String(20 - i).padStart(2, "0")}T00:00:00Z`,
			}),
		);
		const merged = mergeCreatorFeed([many]);
		expect(merged).toHaveLength(12);
		expect(merged[0].id).toBe("v0");
		expect(merged[11].id).toBe("v11");
	});

	it("drops uploads that don't name Old World in the title", () => {
		const a = [
			vid({
				id: "keep",
				published_at: "2026-01-10T00:00:00Z",
				title: "Old World — Assyria deity",
			}),
			vid({
				id: "drop",
				published_at: "2026-01-09T00:00:00Z",
				title: "Civilization VII first look",
			}),
		];
		expect(mergeCreatorFeed([a]).map((v) => v.id)).toEqual(["keep"]);
	});

	it("matches the title case-insensitively, anywhere in the string", () => {
		const a = [
			vid({
				id: "u",
				published_at: "2026-01-03T00:00:00Z",
				title: "OLD WORLD",
			}),
			vid({
				id: "m",
				published_at: "2026-01-02T00:00:00Z",
				title: "Ranking every old world nation",
			}),
			// "OW" shorthand is deliberately not matched — see titlesOldWorld.
			vid({
				id: "s",
				published_at: "2026-01-01T00:00:00Z",
				title: "OW MP #12",
			}),
		];
		expect(mergeCreatorFeed([a]).map((v) => v.id)).toEqual(["u", "m"]);
	});

	it("fills the cap from later videos when newer ones are filtered out", () => {
		// Sixteen uploads, newest first; the four newest are off-topic. The cap is
		// applied after the filter, so the strip still fills with twelve.
		const many = Array.from({ length: 16 }, (_, i) =>
			vid({
				id: `v${i}`,
				published_at: `2026-01-${String(16 - i).padStart(2, "0")}T00:00:00Z`,
				title: i < 4 ? `Other game ${i}` : `Old World ${i}`,
			}),
		);
		const merged = mergeCreatorFeed([many]);
		expect(merged).toHaveLength(12);
		expect(merged[0].id).toBe("v4");
	});

	it("preserves creator attribution on each video", () => {
		const merged = mergeCreatorFeed([
			[
				vid({
					id: "x",
					published_at: "2026-01-01T00:00:00Z",
					user_id: "u42",
					display_name: "Zed",
					avatar_url: "https://example.test/z.png",
				}),
			],
		]);
		expect(merged[0]).toMatchObject({
			user_id: "u42",
			display_name: "Zed",
			avatar_url: "https://example.test/z.png",
		});
	});
});

describe("featuredFirst", () => {
	const feed = [
		vid({ id: "f1", published_at: "2026-03-01T00:00:00Z" }),
		vid({ id: "f2", published_at: "2026-02-01T00:00:00Z" }),
		vid({ id: "f3", published_at: "2026-01-01T00:00:00Z" }),
	];

	it("leads with the featured videos, each half newest-first", () => {
		const featured = [
			vid({ id: "f3", published_at: "2026-01-01T00:00:00Z" }),
			vid({ id: "f2", published_at: "2026-02-01T00:00:00Z" }),
		];
		expect(featuredFirst(featured, feed).map((v) => v.id)).toEqual([
			"f2",
			"f3",
			"f1",
		]);
	});

	it("renders the stored snapshot, not the feed's copy of the same video", () => {
		// Same (platform, video_id), different title: the row is what the owner
		// featured, and two entries sharing a key would crash the tab's keyed
		// {#each} with each_key_duplicate.
		const featured = [
			vid({
				id: "f2",
				published_at: "2026-02-01T00:00:00Z",
				title: "Old World — as featured",
			}),
		];
		const merged = featuredFirst(featured, feed);
		expect(merged.map((v) => v.id)).toEqual(["f2", "f1", "f3"]);
		expect(merged[0].title).toBe("Old World — as featured");
	});

	it("keeps a featured video that has aged out of the feed", () => {
		// The reason the row is a snapshot: a channel's feed returns ~15 entries,
		// so the video an owner wants at the top is the first one to leave it.
		const featured = [
			vid({ id: "gone", published_at: "2025-06-01T00:00:00Z" }),
		];
		expect(featuredFirst(featured, feed).map((v) => v.id)).toEqual([
			"gone",
			"f1",
			"f2",
			"f3",
		]);
	});

	it("leaves the feed alone when nothing is featured", () => {
		expect(featuredFirst([], feed).map((v) => v.id)).toEqual([
			"f1",
			"f2",
			"f3",
		]);
	});

	it("does not mutate the arrays it is given", () => {
		const featured = [
			vid({ id: "a", published_at: "2026-01-01T00:00:00Z" }),
			vid({ id: "b", published_at: "2026-05-01T00:00:00Z" }),
		];
		featuredFirst(featured, feed);
		expect(featured.map((v) => v.id)).toEqual(["a", "b"]);
	});
});
