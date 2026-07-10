import { describe, expect, it } from "vitest";
import {
	decodeXmlEntities,
	parseYouTubeChannelUrl,
	parseYouTubeFeed,
} from "./youtube";

// A syntactically valid channel id: UC + 22 url-safe chars.
const CHANNEL_ID = "UCabcdefghijklmnopqrstuv";

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
