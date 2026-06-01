import type { PageLoad } from "./$types";

// Matches view. Backing data comes from the [slug] layout load; this page only
// sets its own meta.
export const load: PageLoad = async ({ parent }) => {
	const { tournament } = await parent();
	return {
		meta: {
			title: `${tournament.name} · Matches - Per-Ankh`,
			description: `Match schedule for ${tournament.name} on Per-Ankh.`,
		},
	};
};
