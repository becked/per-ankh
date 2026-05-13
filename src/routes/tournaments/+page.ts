import { cloudApi } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch }) => {
	const { tournaments } = await cloudApi.listTournaments(
		{ limit: 100 },
		{ fetch },
	);
	return {
		tournaments,
		meta: {
			title: "Tournaments — Per-Ankh",
			description: "Live and past Old World tournaments hosted on Per-Ankh.",
		},
	};
};
