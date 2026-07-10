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
	// ISO 8601 publish instant.
	published_at: string;
	platform: VideoPlatform;
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
// URL resolves without it; only handle/username resolution calls the Data API.
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
	// serving a prior good result instead of caching an error as "empty".
	fetchRecent(channelId: string, env: VideoEnv): Promise<Video[]>;
}
