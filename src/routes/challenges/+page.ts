import { cloudApi } from "$lib/api-cloud";
import { rethrowRateLimit } from "$lib/utils/load-errors";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch }) => {
	// Public list — loads for anonymous visitors too.
	try {
		const { challenges } = await cloudApi.listChallenges({ fetch });
		return {
			challenges,
			meta: {
				title: "Challenge Maps - Per-Ankh",
				description:
					"Community challenge maps: download the save, play it, upload your run.",
			},
		};
	} catch (err) {
		rethrowRateLimit(err);
		throw err;
	}
};
