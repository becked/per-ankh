// One image, cover-cropped to a square and clipped to a circle. A canvas
// consumer draws an image as a rectangle and has no border-radius of its own —
// ECharts' rich-text label backgrounds and deck.gl's `IconLayer` both do — so
// the round crop has to be in the pixels. Client-only (Image + canvas) — call
// from an effect, never during SSR.

/**
 * Draw `url` as a circle filling a `px`×`px` canvas.
 *
 * `anchorY` places the square crop in a source taller than it is wide, the way
 * the second value of CSS `object-position` does: 0.5 centres it, lower keeps
 * the top of the frame. `crossOrigin` is set for remote images (a CDN that
 * serves `Access-Control-Allow-Origin` keeps the canvas untainted); a
 * same-origin sprite is unaffected.
 */
async function circularCanvas(
	url: string,
	px: number,
	anchorY: number,
): Promise<HTMLCanvasElement> {
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
	// Cover-crop to a square: the centred slice horizontally, `anchorY` down
	// the vertical overflow.
	const side = Math.min(img.naturalWidth, img.naturalHeight);
	ctx.drawImage(
		img,
		(img.naturalWidth - side) / 2,
		(img.naturalHeight - side) * anchorY,
		side,
		side,
		0,
		0,
		px,
		px,
	);
	return canvas;
}

/**
 * The circle as a data URL, for a consumer that takes an image address —
 * `img-src` carries `data:`, which `connect-src` does not.
 */
export async function circularDataUrl(
	url: string,
	px: number,
	anchorY = 0.5,
): Promise<string> {
	return (await circularCanvas(url, px, anchorY)).toDataURL();
}

/** The circle as PNG bytes, for a consumer that reads the image itself. */
export async function circularPng(
	url: string,
	px: number,
	anchorY = 0.5,
): Promise<Blob> {
	const canvas = await circularCanvas(url, px, anchorY);
	const png = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, "image/png"),
	);
	if (!png) throw new Error("canvas.toBlob returned nothing");
	return png;
}
