import { error } from "@sveltejs/kit";
import { ApiError, cloudApi } from "$lib/api-cloud";
import { rethrowRateLimit } from "$lib/utils/load-errors";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ params, fetch }) => {
	// Public — a shared challenge URL renders for anonymous visitors; the
	// viewer block comes back null for them.
	const number = Number(params.number);
	if (!Number.isInteger(number) || number < 1) {
		throw error(404, "Challenge not found");
	}
	try {
		const detail = await cloudApi.getChallenge(number, { fetch });
		return {
			...detail,
			meta: {
				title: `Challenge #${detail.challenge.number}: ${detail.challenge.title} - Per-Ankh`,
				description:
					detail.challenge.description || "A Per-Ankh challenge map.",
			},
		};
	} catch (err) {
		rethrowRateLimit(err);
		if (err instanceof ApiError && err.status === 404) {
			throw error(404, "Challenge not found");
		}
		throw err;
	}
};
