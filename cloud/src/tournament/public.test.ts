import { describe, expect, it } from "vitest";
import { mergeTournamentFeed } from "./public";
import type { PlaylistVideo } from "../video/types";

// A playlist video with sensible defaults — override only what a case cares
// about. Titles deliberately don't name Old World: this feed is unfiltered
// (a tournament's admins curated the playlist), unlike the creator feed, and
// the cases below pin that.
function vid(
	over: Partial<PlaylistVideo> & { id: string; published_at: string },
): PlaylistVideo {
	return {
		title: `Round match ${over.id}`,
		url: `https://youtu.be/${over.id}`,
		thumbnail_url: null,
		platform: "youtube",
		duration_seconds: null,
		uploader_channel_id: "UCcaster",
		uploader_name: "Caster One",
		...over,
	};
}

describe("mergeTournamentFeed", () => {
	it("orders newest-first across tournaments", () => {
		const a = [
			vid({ id: "a1", published_at: "2026-01-10T00:00:00Z" }),
			vid({ id: "a2", published_at: "2026-01-01T00:00:00Z" }),
		];
		const b = [vid({ id: "b1", published_at: "2026-01-05T00:00:00Z" })];
		expect(mergeTournamentFeed([a, b]).map((v) => v.id)).toEqual([
			"a1",
			"b1",
			"a2",
		]);
	});

	it("keeps uploads whose titles don't name Old World", () => {
		const a = [
			vid({
				id: "m1",
				published_at: "2026-01-02T00:00:00Z",
				title: "R3: A v B",
			}),
			vid({
				id: "m2",
				published_at: "2026-01-01T00:00:00Z",
				title: "Civilization VII first look",
			}),
		];
		expect(mergeTournamentFeed([a]).map((v) => v.id)).toEqual(["m1", "m2"]);
	});

	it("caps the merged feed to the default size, newest kept", () => {
		// Descending timestamps → v0 newest, v19 oldest.
		const many = Array.from({ length: 20 }, (_, i) =>
			vid({
				id: `v${i}`,
				published_at: `2026-01-${String(20 - i).padStart(2, "0")}T00:00:00Z`,
			}),
		);
		const merged = mergeTournamentFeed([many]);
		expect(merged).toHaveLength(12);
		expect(merged[0].id).toBe("v0");
		expect(merged[11].id).toBe("v11");
	});

	it("collapses a video listed on two tournaments' playlists", () => {
		const a = [
			vid({ id: "shared", published_at: "2026-01-10T00:00:00Z" }),
			vid({ id: "a1", published_at: "2026-01-09T00:00:00Z" }),
		];
		const b = [vid({ id: "shared", published_at: "2026-01-10T00:00:00Z" })];
		expect(mergeTournamentFeed([a, b]).map((v) => v.id)).toEqual([
			"shared",
			"a1",
		]);
	});

	it("dedupes before the cap so a duplicate doesn't burn a slot", () => {
		const many = Array.from({ length: 13 }, (_, i) =>
			vid({
				id: `v${i}`,
				published_at: `2026-01-${String(13 - i).padStart(2, "0")}T00:00:00Z`,
			}),
		);
		// The newest video also sits on a second tournament's playlist.
		const merged = mergeTournamentFeed([many, [many[0]]]);
		expect(merged).toHaveLength(12);
		expect(merged.map((v) => v.id)).toEqual(
			Array.from({ length: 12 }, (_, i) => `v${i}`),
		);
	});

	it("preserves the uploader fields attribution reads", () => {
		const merged = mergeTournamentFeed([
			[
				vid({
					id: "x",
					published_at: "2026-01-01T00:00:00Z",
					uploader_channel_id: "UCzed",
					uploader_name: "Zed",
				}),
			],
		]);
		expect(merged[0]).toMatchObject({
			uploader_channel_id: "UCzed",
			uploader_name: "Zed",
		});
	});
});
