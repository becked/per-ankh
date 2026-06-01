import type { PageLoad } from "./$types";

// Tournament data is loaded once in +layout.ts and merged into page data; this
// page only contributes its own meta (the overview title/description).
export const load: PageLoad = async ({ parent }) => {
	const { tournament } = await parent();
	return {
		meta: {
			title: `${tournament.name} - Per-Ankh`,
			description: tournament.description ?? `${tournament.name} on Per-Ankh.`,
		},
	};
};
