// Video/stream provider abstraction.
//
// A user links a channel on some platform (YouTube today; Twitch et al.
// later); we render their recent uploads on the profile "Videos" tab. Every
// platform-specific concern — how to recognize a channel URL, how to resolve
// it to a stable native id, how to fetch recent videos — lives behind the
// `VideoProvider` interface. The rest of the app (handlers, cache, storage)
// is platform-agnostic and talks only to this interface + the registry.
//
// Adding a platform = implementing one provider and registering it (see
// registry.ts). No handler, schema, or DB change.

// The set of platforms with a registered provider. Extend the union as
// providers are added — the registry is the runtime source of truth for
// which are actually wired.
export type VideoPlatform = "youtube";

// One recent video, normalized across platforms.
export interface Video {
	// Provider-native video id (YouTube: the 11-char watch id). Stable per
	// video; used as the list key.
	id: string;
	title: string;
	// Canonical watch URL on the platform.
	url: string;
	// Best available thumbnail, or null if the feed omitted one.
	thumbnail_url: string | null;
	// ISO 8601. When the video went up — except for live content, where it is
	// when the broadcast aired rather than when its VOD was later published (see
	// the broadcast-dates note in youtube.ts). Feeds report the latter, and it
	// runs hours late, so the two are worth keeping straight.
	published_at: string;
	platform: VideoPlatform;
	// Runtime in seconds, or null when unknown. Only videos.list carries this,
	// so it is null on every keyless path (the free RSS feeds say nothing about
	// length) and on a broadcast still running. See fetchVideoFacts in
	// youtube.ts — it rides along on the call that already re-dates broadcasts,
	// so it costs no extra quota. Every null case except the keyless one heals
	// itself: a broadcast still running picks up its runtime on the next refresh
	// past the 1h soft TTL, and a degraded batch is never cached.
	duration_seconds: number | null;
}

// A video from a playlist feed, which — unlike a channel feed — can mix
// uploaders. Carries the per-entry uploading channel so the tournament videos
// read can attribute each video (map a linked channel to its Per-Ankh user, or
// fall back to the raw YouTube channel name). Both null when the feed omitted
// the author. Kept off the base Video so the channel/profile feeds are
// unaffected.
export interface PlaylistVideo extends Video {
	uploader_channel_id: string | null;
	uploader_name: string | null;
}

// Newest first, for any list of normalized videos. ISO timestamps sort
// lexically, and an entry missing a date ("") falls to the end. Every fetch and
// merge path sorts through this, so the "newest first" contract they each
// document has one definition.
export function byPublishedDesc(a: Video, b: Video): number {
	return a.published_at < b.published_at ? 1 : -1;
}

// A resolved channel: the platform, the (canonicalized) URL we show the
// user, and the native id the fetch path needs.
export interface ChannelIdentity {
	platform: VideoPlatform;
	channel_url: string;
	channel_id: string;
}

// Bindings a provider may need: KV for the recent-videos cache, and any
// per-provider API credential. YOUTUBE_API_KEY is optional — a `/channel/UC…`
// URL resolves without it, and the fetch path falls back to the feed's own
// dates. With it, handle/username resolution and the broadcast-date pass on
// recent videos both call the Data API (see youtube.ts).
export interface VideoEnv {
	SESSIONS_KV: KVNamespace;
	YOUTUBE_API_KEY?: string;
}

// Thrown by resolve() when a user-entered channel URL can't be turned into a
// stored identity. `code`/`httpStatus` map straight onto the handler's error
// response so the settings UI can show a specific, actionable message.
export class ChannelResolutionError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly httpStatus = 400,
	) {
		super(message);
		this.name = "ChannelResolutionError";
	}
}

// Thrown by a fetch path that produced usable videos it does not want
// persisted: the list is serve-able but degraded, so caching it would hold the
// degradation for the whole TTL. Today's one source is a failed videos.list
// enrichment (see fetchVideoFacts in youtube.ts), which costs those videos two
// things: live content stays dated by its VOD publish instant — the very bug
// the enrichment exists to fix — and every video in the failed batch keeps a
// null duration_seconds. The cache layer serves `videos` and skips the write,
// so a warm entry keeps its prior good dates and runtimes, and a cold miss
// simply retries next request.
export class UncacheableVideos extends Error {
	constructor(readonly videos: Video[]) {
		super("video fetch degraded — serve, do not cache");
		this.name = "UncacheableVideos";
	}
}

export interface VideoProvider {
	readonly platform: VideoPlatform;

	// True iff this provider recognizes `rawUrl` as one of its channel URLs
	// (or bare handles). Used by the registry to route a user-entered URL to
	// the right provider without resolving it.
	matches(rawUrl: string): boolean;

	// Turn a user-entered channel URL/handle into a stored identity, calling
	// out to the platform API where resolution requires it. Throws
	// ChannelResolutionError on invalid or unresolvable input.
	resolve(rawUrl: string, env: VideoEnv): Promise<ChannelIdentity>;

	// Fetch the channel's recent videos from the platform (uncached — the
	// cache layer wraps this). Returns [] for a channel with no uploads;
	// THROWS on a transient upstream failure so the cache layer can keep
	// serving a prior good result instead of caching an error as "empty", and
	// throws UncacheableVideos when it has videos worth serving but not
	// storing. A caller outside the cache layer must handle the latter — it
	// carries a perfectly good list (see scripts/admin/commands/channels.ts).
	fetchRecent(channelId: string, env: VideoEnv): Promise<Video[]>;
}
