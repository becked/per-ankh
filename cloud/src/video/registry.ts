// Provider registry — the runtime source of truth for which video platforms
// are supported. Adding a platform is a one-line edit here (plus its provider
// module and a widening of the VideoPlatform union); handlers, cache, schema,
// and DB are all platform-agnostic and go through this registry.

import type { VideoPlatform, VideoProvider } from "./types";
import { youtubeProvider } from "./youtube";

const PROVIDERS: readonly VideoProvider[] = [youtubeProvider];

// The provider for an already-known platform (e.g. a stored channel row).
export function providerForPlatform(platform: string): VideoProvider | null {
	return PROVIDERS.find((p) => p.platform === platform) ?? null;
}

// Route a user-entered channel URL to the provider that recognizes it, or
// null if no supported platform matches.
export function providerForUrl(rawUrl: string): VideoProvider | null {
	return PROVIDERS.find((p) => p.matches(rawUrl)) ?? null;
}

// Platforms with a registered provider — e.g. for surfacing "supported
// platforms" hints in the UI or validation messages.
export function supportedPlatforms(): VideoPlatform[] {
	return PROVIDERS.map((p) => p.platform);
}
