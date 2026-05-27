import type { PageLoad } from "./$types";

// Static content page — no data load. Exists solely to set the page
// `meta` so the tab <title> and og:/twitter: tags match the rest of the
// app (rendered once in +layout.svelte from `data.meta`).
export const load: PageLoad = () => {
	return {
		meta: {
			title: "Tournament Guide - Per-Ankh",
			description: "How Old World tournaments work on Per-Ankh.",
		},
	};
};
