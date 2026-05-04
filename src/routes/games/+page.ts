// Loads the user's game library. Runs client-side because adapter-static +
// ssr=false. SvelteKit still gives us a typed `load` boundary with redirect/
// error helpers; the only difference vs SSR is timing.

import { redirect } from "@sveltejs/kit";
import { cloudApi, UnauthorizedError } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch }) => {
	try {
		const list = await cloudApi.listGames({ fetch });
		return list;
	} catch (err) {
		if (err instanceof UnauthorizedError) {
			throw redirect(303, "/login?next=/games");
		}
		throw err;
	}
};
