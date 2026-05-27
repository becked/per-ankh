// Page metadata for social-link unfurling. The root +layout.svelte
// renders one canonical og:* / twitter:* block from `data.meta`; pages
// override by returning their own `meta` from a load function.
//
// Single source of truth → no duplicate <meta> tags in the rendered head
// (which crawlers handle inconsistently across platforms).

export type PageMeta = {
	title: string;
	description: string;
	// Absolute URL. Falls back to `${PUBLIC_ORIGIN}/og-default.png` in the
	// layout when omitted.
	image?: string;
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
