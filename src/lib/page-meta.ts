// Page metadata for social-link unfurling. The root +layout.svelte
// renders one canonical og:* / twitter:* block from `data.meta`; pages
// override by returning their own `meta` from a load function.
//
// Single source of truth → no duplicate <meta> tags in the rendered head
// (which crawlers handle inconsistently across platforms).

export type OgImage = {
	// Absolute URL. Crawlers require one; relative paths are silently dropped
	// by some.
	url: string;
	// Declared to the crawler as og:image:width / og:image:height, which is
	// what lets it reserve the embed's image slot before the bytes land.
	// Grouped with the URL rather than sat beside it as two more optional
	// fields: a size that belongs to a different image is worse than no size.
	width: number;
	height: number;
};

export type PageMeta = {
	title: string;
	description: string;
	// Falls back to DEFAULT_OG_IMAGE in the layout when omitted.
	image?: OgImage;
};

export const DEFAULT_META: PageMeta = {
	title: "Per-Ankh - Old World Save Analytics",
	description:
		"Upload and analyze your Old World save files: charts, maps, tech, religion, and more.",
};

// Origin used to build absolute URLs for og:image / og:url. Crawlers
// require absolute URLs; relative paths are silently dropped by some.
export const PUBLIC_ORIGIN = (import.meta.env.VITE_PUBLIC_ORIGIN ??
	"https://per-ankh.app") as string;

// The brand card every page without one of its own unfurls with. The pair is
// the committed static/og-default.png's own size, measured from the file — a
// crawler lays its image slot out from these two numbers, so they cannot be
// assumed.
//
// It is NOT what `npm run bake:og` (scripts/make-og-default.mjs) produces:
// that script writes 1200×630 (`W`/`H` at its top), and the shipped PNG
// predates it. Re-baking the brand card therefore means re-measuring and
// updating this pair in the same change. Nothing checks it — the frontend has
// no test runner — so this comment is the guard.
export const DEFAULT_OG_IMAGE: OgImage = {
	url: `${PUBLIC_ORIGIN}/og-default.png`,
	width: 1182,
	height: 374,
};

// The accent Discord paints down the left edge of an embed, and the colour a
// mobile browser tints its chrome with. `--color-blue-gray` in src/app.css —
// the app's own page background, so the browser chrome matches the page and
// the embed stripe matches the card beside it. Hex rather than the variable
// for the same reason the chart theme is: a <meta> content attribute has no
// stylesheet to resolve one against.
export const THEME_COLOR = "#211a12";
