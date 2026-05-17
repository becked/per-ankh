import { error } from "@sveltejs/kit";
import { ApiError, cloudApi } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch }) => {
	try {
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
	} catch (err) {
		// Beta gate returns 404 to non-beta users. Surface as SvelteKit
		// 404 so the page renders the not-found view rather than a
		// generic "Internal Error."
		if (err instanceof ApiError && err.status === 404) {
			throw error(404, "Not found");
		}
		throw err;
	}
};
