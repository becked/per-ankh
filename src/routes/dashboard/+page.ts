// Dashboard load — cross-game stats for the cloud user.
// Mirrors the desktop overview: total games + games-by-nation + 6-month
// nation calendar.

import { redirect } from "@sveltejs/kit";
import { cloudApi, UnauthorizedError } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
	try {
		const stats = await cloudApi.getStats({ fetch });
		return { stats };
	} catch (err) {
		if (err instanceof UnauthorizedError) {
			throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
		}
		throw err;
	}
};
