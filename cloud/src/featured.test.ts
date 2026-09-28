import { describe, expect, it } from "vitest";
import { attributeFeaturedVideo, type FeaturedVideoRow } from "./featured";

// A read-query row with the snapshot filled in and no uploader attribution —
// override only the columns a case is about.
function row(over: Partial<FeaturedVideoRow> = {}): FeaturedVideoRow {
	return {
		platform: "youtube",
		video_id: "vid1",
		url: "https://youtu.be/vid1",
		title: "Old World — Assyria opening",
		thumbnail_url: "https://i.ytimg.com/vi/vid1/hq.jpg",
		published_at: "2026-07-01T12:00:00Z",
		uploader_name: null,
		uploader_url: null,
		user_id: null,
		display_name: null,
		slug: null,
		discord_id: null,
		avatar_hash: null,
		...over,
	};
}

describe("attributeFeaturedVideo", () => {
	it("carries the stored snapshot onto every shape", () => {
		expect(attributeFeaturedVideo(row())).toEqual({
			id: "vid1",
			title: "Old World — Assyria opening",
			url: "https://youtu.be/vid1",
			thumbnail_url: "https://i.ytimg.com/vi/vid1/hq.jpg",
			published_at: "2026-07-01T12:00:00Z",
			platform: "youtube",
			// The featured table has no duration column, so this is null for every
			// featured video rather than unknown for some — see attributeFeaturedVideo.
			duration_seconds: null,
		});
	});

	it("attributes a linked Per-Ankh uploader from the live join, not the row", () => {
		const attributed = attributeFeaturedVideo(
			row({
				user_id: "u_00000000000000000001",
				// The joined value is COALESCE(alias, display_name), so a renamed
				// user reads as the new name here — the point of not snapshotting it.
				display_name: "Renamed Creator",
				slug: "renamed-creator",
				discord_id: "123456789012345678",
				avatar_hash: "abc123",
				// Ignored: a linked user outranks the raw channel fallback.
				uploader_name: "Some YouTube Channel",
				uploader_url: "https://www.youtube.com/channel/UC123",
			}),
		);
		expect(attributed).toMatchObject({
			user_id: "u_00000000000000000001",
			display_name: "Renamed Creator",
			slug: "renamed-creator",
			avatar_url:
				"https://cdn.discordapp.com/avatars/123456789012345678/abc123.png",
		});
		expect(attributed).not.toHaveProperty("uploader_name");
	});

	it("falls back to the raw YouTube channel when no user is linked", () => {
		expect(
			attributeFeaturedVideo(
				row({
					uploader_name: "Some YouTube Channel",
					uploader_url: "https://www.youtube.com/channel/UC123",
				}),
			),
		).toMatchObject({
			uploader_name: "Some YouTube Channel",
			uploader_url: "https://www.youtube.com/channel/UC123",
		});
	});

	it("falls through when a stored user_id has no joined identity", () => {
		// The join, not the stored id, is what the first branch needs — there is
		// no name or avatar to render without it. Falling through is what keeps
		// the card renderable.
		const attributed = attributeFeaturedVideo(
			row({
				user_id: "u_00000000000000000001",
				uploader_name: "Some YouTube Channel",
				uploader_url: "https://www.youtube.com/channel/UC123",
			}),
		);
		expect(attributed).not.toHaveProperty("user_id");
		expect(attributed).toMatchObject({ uploader_name: "Some YouTube Channel" });
	});

	it("leaves a video with no author unattributed", () => {
		const attributed = attributeFeaturedVideo(row());
		expect(attributed).not.toHaveProperty("user_id");
		expect(attributed).not.toHaveProperty("uploader_name");
	});

	it("needs both channel fields to attribute an unlinked uploader", () => {
		// A name with no URL would render a link to nowhere.
		const attributed = attributeFeaturedVideo(
			row({ uploader_name: "Some YouTube Channel" }),
		);
		expect(attributed).not.toHaveProperty("uploader_name");
	});
});
