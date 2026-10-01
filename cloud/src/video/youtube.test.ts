import { afterEach, describe, expect, it, vi } from "vitest";
import {
	applyVideoFacts,
	decodeXmlEntities,
	fetchYouTubePlaylistVideosViaApi,
	parsePlaylistItemsPage,
	parseIsoDuration,
	parseVideosListPage,
	parseYouTubeChannelUrl,
	parseYouTubeFeed,
	parseYouTubePlaylistFeed,
	parseYouTubePlaylistUrl,
} from "./youtube";
import { UncacheableVideos, type Video } from "./types";

// A syntactically valid channel id: UC + 22 url-safe chars.
const CHANNEL_ID = "UCabcdefghijklmnopqrstuv";
// A syntactically valid playlist id: PL + 32 url-safe chars.
const PLAYLIST_ID = "PLabcdefghijklmnopqrstuvwxyz012345";

describe("parseYouTubeChannelUrl", () => {
	it("parses a bare @handle", () => {
		expect(parseYouTubeChannelUrl("@SomeCreator")).toEqual({
			kind: "handle",
			handle: "SomeCreator",
		});
	});

	it("parses a handle URL with or without scheme and trailing path", () => {
		expect(
			parseYouTubeChannelUrl("https://www.youtube.com/@SomeCreator"),
		).toEqual({ kind: "handle", handle: "SomeCreator" });
		expect(parseYouTubeChannelUrl("youtube.com/@SomeCreator/videos")).toEqual({
			kind: "handle",
			handle: "SomeCreator",
		});
		expect(
			parseYouTubeChannelUrl("  https://m.youtube.com/@Creator  "),
		).toEqual({ kind: "handle", handle: "Creator" });
	});

	it("parses a /channel/UC… id URL without resolution", () => {
		expect(
			parseYouTubeChannelUrl(`https://www.youtube.com/channel/${CHANNEL_ID}`),
		).toEqual({ kind: "id", channelId: CHANNEL_ID });
	});

	it("rejects a /channel/ path whose id is malformed", () => {
		expect(
			parseYouTubeChannelUrl("https://www.youtube.com/channel/not-an-id"),
		).toBeNull();
	});

	it("parses legacy /user/ and custom /c/ paths", () => {
		expect(
			parseYouTubeChannelUrl("https://youtube.com/user/LegacyName"),
		).toEqual({ kind: "user", username: "LegacyName" });
		expect(parseYouTubeChannelUrl("https://youtube.com/c/CustomName")).toEqual({
			kind: "custom",
			name: "CustomName",
		});
	});

	it("returns null for non-YouTube or unrecognizable input", () => {
		expect(parseYouTubeChannelUrl("https://twitch.tv/streamer")).toBeNull();
		expect(parseYouTubeChannelUrl("https://vimeo.com/@x")).toBeNull();
		expect(
			parseYouTubeChannelUrl("https://www.youtube.com/watch?v=abc"),
		).toBeNull();
		expect(parseYouTubeChannelUrl("")).toBeNull();
		expect(parseYouTubeChannelUrl("just some text")).toBeNull();
	});
});

describe("parseYouTubePlaylistUrl", () => {
	it("parses a playlist URL, with or without scheme and extra params", () => {
		expect(
			parseYouTubePlaylistUrl(
				`https://www.youtube.com/playlist?list=${PLAYLIST_ID}`,
			),
		).toEqual({ playlistId: PLAYLIST_ID });
		expect(
			parseYouTubePlaylistUrl(`youtube.com/playlist?list=${PLAYLIST_ID}`),
		).toEqual({ playlistId: PLAYLIST_ID });
		expect(
			parseYouTubePlaylistUrl(
				`  https://m.youtube.com/playlist?list=${PLAYLIST_ID}&foo=bar  `,
			),
		).toEqual({ playlistId: PLAYLIST_ID });
	});

	it("extracts the list id from a watch URL", () => {
		expect(
			parseYouTubePlaylistUrl(
				`https://www.youtube.com/watch?v=VID0000001&list=${PLAYLIST_ID}`,
			),
		).toEqual({ playlistId: PLAYLIST_ID });
	});

	it("accepts a bare playlist id", () => {
		expect(parseYouTubePlaylistUrl(PLAYLIST_ID)).toEqual({
			playlistId: PLAYLIST_ID,
		});
	});

	it("returns null for non-YouTube hosts or a missing/malformed list id", () => {
		expect(
			parseYouTubePlaylistUrl(`https://vimeo.com/playlist?list=${PLAYLIST_ID}`),
		).toBeNull();
		expect(
			parseYouTubePlaylistUrl("https://www.youtube.com/playlist?list=short"),
		).toBeNull();
		expect(
			parseYouTubePlaylistUrl("https://www.youtube.com/watch?v=VID0000001"),
		).toBeNull();
		expect(parseYouTubePlaylistUrl("PL nope")).toBeNull();
		expect(parseYouTubePlaylistUrl("")).toBeNull();
	});
});

describe("decodeXmlEntities", () => {
	it("decodes the common named and numeric entities", () => {
		expect(decodeXmlEntities("Tom &amp; Jerry")).toBe("Tom & Jerry");
		expect(decodeXmlEntities("&lt;b&gt;")).toBe("<b>");
		expect(decodeXmlEntities("it&#39;s &quot;fine&quot;")).toBe('it\'s "fine"');
		expect(decodeXmlEntities("&#x27;hex&#x27;")).toBe("'hex'");
	});

	it("decodes &amp; last so escaped entities don't double-decode", () => {
		expect(decodeXmlEntities("&amp;lt;")).toBe("&lt;");
	});
});

describe("parseYouTubeFeed", () => {
	const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>Channel Title</title>
  <entry>
    <id>yt:video:VID0000001</id>
    <yt:videoId>VID0000001</yt:videoId>
    <title>First &amp; Best</title>
    <published>2026-07-01T10:00:00+00:00</published>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/VID0000001/hqdefault.jpg" width="480" height="360"/>
    </media:group>
  </entry>
  <entry>
    <id>yt:video:VID0000002</id>
    <yt:videoId>VID0000002</yt:videoId>
    <title>Second</title>
    <published>2026-06-20T10:00:00+00:00</published>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/VID0000002/hqdefault.jpg" width="480" height="360"/>
    </media:group>
  </entry>
</feed>`;

	it("extracts videos in feed order with decoded titles and thumbnails", () => {
		const videos = parseYouTubeFeed(feed);
		expect(videos).toHaveLength(2);
		expect(videos[0]).toEqual({
			id: "VID0000001",
			duration_seconds: null,
			title: "First & Best",
			url: "https://www.youtube.com/watch?v=VID0000001",
			thumbnail_url: "https://i.ytimg.com/vi/VID0000001/hqdefault.jpg",
			published_at: "2026-07-01T10:00:00+00:00",
			platform: "youtube",
		});
		expect(videos[1].id).toBe("VID0000002");
	});

	it("skips entries without a video id and ignores the channel-level title", () => {
		const partial = `<feed>
  <title>Channel Title</title>
  <entry><title>no id here</title><published>2026-01-01T00:00:00+00:00</published></entry>
  <entry><yt:videoId>VID9999999</yt:videoId><title>Has Id</title><published>2026-01-02T00:00:00+00:00</published></entry>
</feed>`;
		const videos = parseYouTubeFeed(partial);
		expect(videos).toHaveLength(1);
		expect(videos[0].id).toBe("VID9999999");
		expect(videos[0].thumbnail_url).toBeNull();
	});

	it("returns [] for an empty or entry-less feed", () => {
		expect(parseYouTubeFeed("<feed></feed>")).toEqual([]);
	});
});

describe("parseYouTubePlaylistFeed", () => {
	const feed = `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>VID0000010</yt:videoId>
    <yt:channelId>UCsooa4yRKGN_zEE8iknghZA</yt:channelId>
    <title>A Cast</title>
    <author><name>Some &amp; Caster</name><uri>https://www.youtube.com/channel/UCsooa4yRKGN_zEE8iknghZA</uri></author>
    <published>2026-05-01T00:00:00+00:00</published>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/VID0000010/hqdefault.jpg" width="480" height="360"/>
    </media:group>
  </entry>
  <entry>
    <yt:videoId>VID0000011</yt:videoId>
    <title>No author here</title>
    <published>2026-04-01T00:00:00+00:00</published>
  </entry>
</feed>`;

	it("captures each entry's uploader channel id and decoded name", () => {
		const videos = parseYouTubePlaylistFeed(feed);
		expect(videos).toHaveLength(2);
		expect(videos[0]).toMatchObject({
			id: "VID0000010",
			title: "A Cast",
			url: "https://www.youtube.com/watch?v=VID0000010",
			uploader_channel_id: "UCsooa4yRKGN_zEE8iknghZA",
			uploader_name: "Some & Caster",
		});
	});

	it("yields null uploader fields when the entry omits the author", () => {
		const videos = parseYouTubePlaylistFeed(feed);
		expect(videos[1].uploader_channel_id).toBeNull();
		expect(videos[1].uploader_name).toBeNull();
	});
});

describe("parsePlaylistItemsPage", () => {
	// One playlistItems.list response with a normal video, a private one (no
	// contentDetails.videoPublishedAt), and a next-page token.
	const page = {
		nextPageToken: "NEXT",
		items: [
			{
				snippet: {
					title: "Round 1: Carthage vs Rome",
					resourceId: { videoId: "VID0000001" },
					thumbnails: {
						default: { url: "https://i.ytimg.com/default.jpg" },
						medium: { url: "https://i.ytimg.com/medium.jpg" },
						high: { url: "https://i.ytimg.com/high.jpg" },
					},
					videoOwnerChannelId: "UCsooa4yRKGN_zEE8iknghZA",
					videoOwnerChannelTitle: "Some Caster",
				},
				contentDetails: {
					videoId: "VID0000001",
					videoPublishedAt: "2026-05-01T00:00:00Z",
				},
			},
			{
				snippet: {
					title: "Private video",
					resourceId: { videoId: "VID0000002" },
				},
				contentDetails: { videoId: "VID0000002" },
			},
		],
	};

	it("maps a live item to a PlaylistVideo, preferring the highest thumbnail", () => {
		const { videos } = parsePlaylistItemsPage(page);
		expect(videos).toHaveLength(1);
		expect(videos[0]).toEqual({
			id: "VID0000001",
			duration_seconds: null,
			title: "Round 1: Carthage vs Rome",
			url: "https://www.youtube.com/watch?v=VID0000001",
			thumbnail_url: "https://i.ytimg.com/high.jpg",
			published_at: "2026-05-01T00:00:00Z",
			platform: "youtube",
			uploader_channel_id: "UCsooa4yRKGN_zEE8iknghZA",
			uploader_name: "Some Caster",
		});
	});

	it("skips private/deleted items (no videoPublishedAt)", () => {
		const { videos } = parsePlaylistItemsPage(page);
		expect(videos.map((v) => v.id)).toEqual(["VID0000001"]);
	});

	it("returns the next page token, or null on the last page", () => {
		expect(parsePlaylistItemsPage(page).nextPageToken).toBe("NEXT");
		expect(parsePlaylistItemsPage({ items: [] }).nextPageToken).toBeNull();
		expect(parsePlaylistItemsPage({}).nextPageToken).toBeNull();
	});

	it("falls back to lower thumbnails and null uploader when fields are absent", () => {
		const { videos } = parsePlaylistItemsPage({
			items: [
				{
					snippet: {
						title: "No owner",
						resourceId: { videoId: "VID0000003" },
						thumbnails: { default: { url: "https://i.ytimg.com/d.jpg" } },
					},
					contentDetails: {
						videoId: "VID0000003",
						videoPublishedAt: "2026-04-01T00:00:00Z",
					},
				},
			],
		});
		expect(videos[0]).toMatchObject({
			thumbnail_url: "https://i.ytimg.com/d.jpg",
			uploader_channel_id: null,
			uploader_name: null,
		});
	});

	it("tolerates a malformed/empty response", () => {
		expect(parsePlaylistItemsPage(null)).toEqual({
			videos: [],
			nextPageToken: null,
		});
	});
});

describe("fetchYouTubePlaylistVideosViaApi — degraded enrichment", () => {
	const playlistPage = {
		items: [
			{
				contentDetails: {
					videoId: "VID0000001",
					videoPublishedAt: "2026-07-31T15:27:03Z",
				},
				snippet: { title: "Cast", thumbnails: {}, resourceId: {} },
			},
		],
	};

	afterEach(() => vi.unstubAllGlobals());

	// The enrichment must never throw: it improves a date and a runtime we can
	// live without, and discarding a feed already fetched would be worse. What
	// it must do is refuse to be cached, or the degradation is held for the TTL.
	it("serves the feed's own dates and null runtimes, uncacheable", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn((url: URL) =>
				Promise.resolve(
					String(url).includes("/videos")
						? // videos.list is the call that fails
							new Response("quota", { status: 403 })
						: new Response(JSON.stringify(playlistPage), { status: 200 }),
				),
			),
		);
		await expect(
			fetchYouTubePlaylistVideosViaApi("PL1", "key"),
		).rejects.toBeInstanceOf(UncacheableVideos);
		try {
			await fetchYouTubePlaylistVideosViaApi("PL1", "key");
		} catch (e) {
			const { videos } = e as UncacheableVideos;
			expect(videos).toHaveLength(1);
			// The feed's VOD date, un-corrected — that is the bug being served.
			expect(videos[0].published_at).toBe("2026-07-31T15:27:03Z");
			// And the runtime the failed batch cost us.
			expect(videos[0].duration_seconds).toBeNull();
		}
	});

	it("does not throw when the enrichment succeeds", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn((url: URL) =>
				Promise.resolve(
					String(url).includes("/videos")
						? new Response(
								JSON.stringify({
									items: [
										{
											id: "VID0000001",
											liveStreamingDetails: {
												actualStartTime: "2026-07-31T01:04:43Z",
											},
											contentDetails: { duration: "PT1H51M54S" },
										},
									],
								}),
								{ status: 200 },
							)
						: new Response(JSON.stringify(playlistPage), { status: 200 }),
				),
			),
		);
		const videos = await fetchYouTubePlaylistVideosViaApi("PL1", "key");
		expect(videos[0].published_at).toBe("2026-07-31T01:04:43Z");
		expect(videos[0].duration_seconds).toBe(6714);
	});
});

describe("parseVideosListPage", () => {
	// Shapes taken from a real
	// videos.list?part=liveStreamingDetails,contentDetails response: an archived
	// broadcast, an ordinary upload (no liveStreamingDetails at all), a
	// broadcast scheduled but never aired, and one still running (P0D).
	const page = {
		items: [
			{
				id: "e5eFJgzYz3Q",
				liveStreamingDetails: {
					actualStartTime: "2026-07-31T01:04:43Z",
					actualEndTime: "2026-07-31T02:56:37Z",
				},
				contentDetails: { duration: "PT1H51M54S" },
			},
			{ id: "VID0000001", contentDetails: { duration: "PT58M" } },
			{
				id: "VID0000002",
				liveStreamingDetails: { scheduledStartTime: "2026-08-09T00:00:00Z" },
			},
			{
				id: "VID0000003",
				liveStreamingDetails: { actualStartTime: "2026-09-11T01:30:00Z" },
				contentDetails: { duration: "P0D" },
			},
		],
	};

	it("maps an archived broadcast to the instant it started", () => {
		expect(parseVideosListPage(page).get("e5eFJgzYz3Q")?.started_at).toBe(
			"2026-07-31T01:04:43Z",
		);
	});

	it("carries the runtime alongside the air time", () => {
		expect(parseVideosListPage(page).get("e5eFJgzYz3Q")?.duration_seconds).toBe(
			1 * 3600 + 51 * 60 + 54,
		);
	});

	it("keeps an ordinary upload for its duration alone", () => {
		const f = parseVideosListPage(page).get("VID0000001");
		expect(f?.started_at).toBeUndefined();
		expect(f?.duration_seconds).toBe(58 * 60);
	});

	it("omits an entry that carries neither fact", () => {
		const facts = parseVideosListPage(page);
		expect(facts.has("VID0000002")).toBe(false);
		// Pinned as a count, not just a has(): the admit-on-either-fact rule is
		// exactly the kind of change that starts letting extra ids in.
		expect(facts.size).toBe(3);
	});

	it("omits the zero duration a still-running broadcast reports", () => {
		const f = parseVideosListPage(page).get("VID0000003");
		expect(f?.started_at).toBe("2026-09-11T01:30:00Z");
		expect(f?.duration_seconds).toBeUndefined();
	});

	it("tolerates a malformed/empty response", () => {
		expect(parseVideosListPage(null).size).toBe(0);
		expect(parseVideosListPage({}).size).toBe(0);
	});
});

describe("parseIsoDuration", () => {
	it("reads hours, minutes and seconds", () => {
		expect(parseIsoDuration("PT1H23M45S")).toBe(5025);
		expect(parseIsoDuration("PT58M")).toBe(3480);
		expect(parseIsoDuration("PT45S")).toBe(45);
		expect(parseIsoDuration("PT2H")).toBe(7200);
	});

	it("reads the day component a very long stream can carry", () => {
		expect(parseIsoDuration("P1DT2H")).toBe(86400 + 7200);
	});

	it("treats a plausible-but-unsupported form as unknown", () => {
		// videos.list does not emit fractional seconds today. If it ever starts,
		// this documents that the runtime goes missing rather than rounding, and
		// fails loudly if someone decides to handle it.
		expect(parseIsoDuration("PT1H23M45.5S")).toBeNull();
		expect(parseIsoDuration("P1W")).toBeNull();
	});

	it("returns null for zero, absent and malformed values", () => {
		expect(parseIsoDuration("P0D")).toBeNull();
		expect(parseIsoDuration(undefined)).toBeNull();
		expect(parseIsoDuration("")).toBeNull();
		expect(parseIsoDuration("1h23m")).toBeNull();
		expect(parseIsoDuration("PT1H23M45")).toBeNull();
	});
});

describe("applyVideoFacts", () => {
	const video = (id: string, published_at: string): Video => ({
		id,
		title: id,
		url: `https://www.youtube.com/watch?v=${id}`,
		thumbnail_url: null,
		published_at,
		platform: "youtube",
		duration_seconds: null,
	});

	it("re-dates a broadcast to its air time and leaves uploads alone", () => {
		const out = applyVideoFacts(
			[
				video("BROADCAST01", "2026-07-31T15:27:03Z"),
				video("UPLOAD00001", "2026-07-30T09:00:00Z"),
			],
			new Map([["BROADCAST01", { started_at: "2026-07-31T01:04:43Z" }]]),
		);
		expect(out.map((v) => v.published_at)).toEqual([
			"2026-07-31T01:04:43Z",
			"2026-07-30T09:00:00Z",
		]);
	});

	// Regression for the reported bug: this cast aired on Jul 30 (21:04 ET) but
	// its VOD was published 14h later on Jul 31, so the feed dated it Jul 31 and
	// the home page rendered it as ~18h newer than it was.
	it("moves a cast back to the day it actually aired", () => {
		const [corrected] = applyVideoFacts(
			[video("e5eFJgzYz3Q", "2026-07-31T15:27:03Z")],
			new Map([["e5eFJgzYz3Q", { started_at: "2026-07-31T01:04:43Z" }]]),
		);
		const skewHours =
			(Date.parse("2026-07-31T15:27:03Z") -
				Date.parse(corrected.published_at)) /
			3_600_000;
		expect(skewHours).toBeCloseTo(14.4, 1);
	});

	it("returns dates untouched when nothing is a broadcast", () => {
		const videos = [video("UPLOAD00001", "2026-07-30T09:00:00Z")];
		expect(applyVideoFacts(videos, new Map())).toEqual(videos);
	});
});
