// Avatar images for canvas chart labels. ECharts rich-text backgrounds draw
// images as rectangles (no border-radius clip) and load remote URLs
// asynchronously, so Discord avatars are pre-rasterized through
// `circularDataUrl` and handed to ECharts as finished images. Client-only
// (Image + canvas) — call from an effect, never during SSR.

import { getSpritePath } from "$lib/game-detail/helpers";
import { circularDataUrl } from "$lib/utils/circular-image";

// The "unclaimed" stand-in icon, shared with PlayerAvatar so charts and DOM
// avatars degrade to the same sprite.
export const UNCLAIMED_AVATAR_ICON = "EFFECTUNIT_ENLIST_ICON";

// Rasterize one circular avatar per row, aligned to `urls`. `size` is the
// on-screen label box in CSS px; rastering at 2× keeps the circle crisp on
// retina. A null URL (unclaimed slot / free-text caster) or a failed load
// falls back to the unclaimed sprite — square and un-clipped, exactly like
// PlayerAvatar's fallback. Never rejects.
export async function loadCircularAvatars(
	urls: (string | null)[],
	size: number,
): Promise<(string | undefined)[]> {
	const fallback = getSpritePath("icons", UNCLAIMED_AVATAR_ICON) ?? undefined;
	const seen = new Map<string, Promise<string | undefined>>();
	return Promise.all(
		urls.map((url) => {
			if (!url) return Promise.resolve(fallback);
			let p = seen.get(url);
			if (!p) {
				p = circularDataUrl(url, size * 2).catch(() => fallback);
				seen.set(url, p);
			}
			return p;
		}),
	);
}
