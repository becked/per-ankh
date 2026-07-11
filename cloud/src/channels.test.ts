import { describe, expect, it } from "vitest";
import { type CreatorVideo, mergeCreatorFeed } from "./channels";

// A CreatorVideo with sensible defaults — override only what a case cares about.
function vid(
	over: Partial<CreatorVideo> & { id: string; published_at: string },
): CreatorVideo {
	return {
		title: `Video ${over.id}`,
		url: `https://youtu.be/${over.id}`,
		thumbnail_url: null,
		platform: "youtube",
		user_id: "u1",
		display_name: "Creator One",
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
		expect(merged).toHaveLength(8);
		expect(merged[0].id).toBe("v0");
		expect(merged[7].id).toBe("v7");
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
