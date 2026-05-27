import { error, redirect } from "@sveltejs/kit";
import { ApiError, cloudApi } from "$lib/api-cloud";
import { loginBounce } from "$lib/utils/safe-next";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
	// Signed-out visitors get bounced to the home page (which is the login
	// surface) with ?next= so they land back here after Discord OAuth. Without
	// this, the worker's beta gate 404s anonymous callers and the page renders
	// not-found instead of prompting login.
	const me = await cloudApi.getMe({ fetch });
	if (!me) {
		throw redirect(303, loginBounce(url));
	}
	try {
		const { tournaments } = await cloudApi.listTournaments(
			{ limit: 100 },
			{ fetch },
		);
		return {
			tournaments,
			meta: {
				title: "Tournaments - Per-Ankh",
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
