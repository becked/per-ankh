// Kebab-case slugify: lowercase, every run of non-alphanumerics collapsed to a
// single hyphen, leading/trailing hyphens trimmed.
//
// Shared by atlasAnchor() ($lib/tournament/map-script-options) and the map-
// caveat bake (scripts/bake-map-caveats.ts) so the runtime anchor and the baked
// table keys are produced by ONE function and can't drift on how they slug.
// The bake imports this by relative path, so keep it dependency-free — it must
// load under tsx outside the SvelteKit build.
export function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
