// The stored variant: the one WebP per screenshot that R2 holds, Clef
// classifies, and every reader renders (issue #289, build-order step 4).
//
// These numbers are the one copy, because three places produce or police the
// same bytes and a disagreement between them silently invalidates the shipped
// bands:
//
//   - the browser worker that re-encodes a picked image (downscale-worker.ts)
//     — the only one of the three that writes what gets stored;
//   - the threshold eval that fitted the bands over the corpus
//     (scripts/eval-screenshot-classifier.ts), which mirrors the resize in
//     sharp because Node cannot run the browser's resampler, and whose
//     numbers are a statement about the stored variant rather than about the
//     files on disk;
//   - the upload endpoint's free pre-filter (cloud/src/screenshots/
//     handlers.ts), which measures the floor below on what actually arrived.
//
// The Worker importing from $lib is the shape cloud/src/games.ts already uses
// for shared domain code (game-detail/gdp-basket), so this module stays free
// of browser APIs: the resize itself lives next door in the worker.

// Long edge 1600 px, area capped at ~1.8 MP. The cap that BINDS is the pixel
// one, not the long edge: Clef's limit is 8 MiB decoded, and decoded RGBA
// bites on non-16:9 shapes — 1920x1080 decodes to 7.91 MiB and squeaks under,
// while 1920x1200 on a 16:10 display is 8.79 MiB and over. 1.8 MP decodes to
// 6.87 MiB, which is safe for 16:9, 16:10 and 4:3 alike.
export const STORED_MAX_LONG_EDGE = 1600;
export const STORED_MAX_PIXELS = 1_800_000;

// Passed explicitly to the encoder rather than left to the browser's default,
// because the eval's sharp mirror encodes at a number and an implementation
// default is not a number either side can read. On sharp's 0-100 scale, which
// the canvas API wants as 0-1 (see downscale-worker.ts).
export const STORED_WEBP_QUALITY = 80;

// The free pre-filter's floor, measured on the stored variant: a quality
// floor for the strip tile and the thumbnail, not a guess at what the image
// is. The endpoint is the enforcer — a client check gates nothing — but the
// browser applies it too, so an image certain to be refused costs neither an
// upload nor one of the hour's classifier attempts.
//
// Deliberately BELOW the 640 px tile width (public-urls.ts): a tight crop —
// one city's layout, one character panel — is a typical upload, and letting
// the tile upscale it is preferred to refusing it. What the floor still
// catches is an image too small to carry the tile at all.
export const MIN_LONG_EDGE = 400;

// Never upscales: the factor is 1 for an image already inside both limits.
// The long edge comes from whichever dimension is larger, because input is
// not reliably a landscape full screen — a portrait crop and a Retina @2x
// capture are both normal uploads rather than outliers.
export function storedScale(width: number, height: number): number {
	return Math.min(
		1,
		STORED_MAX_LONG_EDGE / Math.max(width, height),
		Math.sqrt(STORED_MAX_PIXELS / (width * height)),
	);
}

export interface StoredSize {
	width: number;
	height: number;
}

// The dimensions the stored variant gets. Rounded, and floored at 1 px, so a
// degenerate single-row input still produces an encodable canvas rather than
// a zero-dimension one (the long-edge floor above refuses it next).
export function storedDimensions(width: number, height: number): StoredSize {
	const scale = storedScale(width, height);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}
