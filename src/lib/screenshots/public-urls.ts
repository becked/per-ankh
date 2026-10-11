// The public addresses of a stored screenshot (issue #289).
//
// Two of them, and both derived from the same object key: the object itself,
// and the one Cloudflare Images transformation the grids render as a tile.
// Nothing stores a second derivative — one object per screenshot is what keeps
// the delete and purge paths single-valued, and that matters more than usual
// here because purge IS the removal mechanism, so a second stored variant
// would mean two deletes and two purges per takedown with two ways to
// half-fail.
//
// Here rather than in the Worker because two things outside it have to name
// the same URLs. The Worker builds them for the readers and purges them when a
// screenshot is removed; `./per-ankh admin delete-game` / `nuke-user` delete a
// game's objects and have to purge the same addresses, from a Node script with
// no Worker bindings. A second copy of the transformation options in the CLI
// would fail the way all such copies fail — the purge would clear a URL
// nothing serves, and the tile would keep rendering with no symptom but the
// picture.
//
// The sibling of stored-variant.ts, and shared for the same reason: these are
// the numbers the stored bytes are addressed BY, where those are the numbers
// the stored bytes ARE.

// The grid tile. Exactly ONE size, and the number of sizes is a billing
// constraint rather than a design preference: each unique variant counts once
// per calendar month against 5,000 free transformations, and the 5-per-game
// cap bounds the corpus at 4,960 screenshots — so one size at full saturation
// lands just under the tier and a second would exceed it. Both grids are
// therefore sized to this tile instead of the other way round (~300 px CSS, so
// 640 covers a 2x display).
//
// `fit=cover` rather than a width alone: the strip has to read as one row, so
// the tile is a fixed 8:5 box either way, and cropping at the edge sends the
// bytes of the box instead of the bytes of a portrait crop the browser would
// then crop again.
const THUMB_OPTIONS = "width=640,height=400,fit=cover";

function host(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "");
}

// The stored WebP, full size — what a tile opens into.
export function screenshotObjectUrl(baseUrl: string, r2Key: string): string {
	return `${host(baseUrl)}/${r2Key}`;
}

// The tile. Transformations are served on the zone and restricted by default
// to same-zone sources, which both image hosts satisfy, so the source is
// written as a path relative to the host rather than as an absolute URL.
export function screenshotThumbnailUrl(baseUrl: string, r2Key: string): string {
	return `${host(baseUrl)}/cdn-cgi/image/${THUMB_OPTIONS}/${r2Key}`;
}

// Every cached address of one screenshot — what a removal has to purge. The
// readers serve both, so a purge of only the first leaves the tile rendering
// from the edge for up to the 30-day Edge TTL.
export function screenshotPublicUrls(baseUrl: string, r2Key: string): string[] {
	return [
		screenshotObjectUrl(baseUrl, r2Key),
		screenshotThumbnailUrl(baseUrl, r2Key),
	];
}
