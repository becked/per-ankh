// Avatar images for canvas chart labels. ECharts rich-text backgrounds draw
// images as rectangles (no border-radius clip) and load remote URLs
// asynchronously, so Discord avatars are pre-rasterized here into circular
// data-URLs: load with CORS (cdn.discordapp.com serves
// Access-Control-Allow-Origin: *, so the canvas stays untainted), clip to a
// circle, and hand ECharts the finished image. Client-only (Image + canvas) —
// call from an effect, never during SSR.

import { getSpritePath } from "$lib/game-detail/helpers";

// The "unclaimed" stand-in icon, shared with PlayerAvatar so charts and DOM
// avatars degrade to the same sprite.
export const UNCLAIMED_AVATAR_ICON = "EFFECTUNIT_ENLIST_ICON";

async function circularDataUrl(url: string, px: number): Promise<string> {
	const img = new Image();
	img.crossOrigin = "anonymous";
	img.src = url;
	await img.decode();
	const canvas = document.createElement("canvas");
	canvas.width = px;
	canvas.height = px;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("2d context unavailable");
	ctx.beginPath();
	ctx.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
	ctx.clip();
	// Center-crop to a square (object-cover), matching PlayerAvatar's <img>.
	const side = Math.min(img.naturalWidth, img.naturalHeight);
	ctx.drawImage(
		img,
		(img.naturalWidth - side) / 2,
		(img.naturalHeight - side) / 2,
		side,
		side,
		0,
		0,
		px,
		px,
	);
	return canvas.toDataURL();
}

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
