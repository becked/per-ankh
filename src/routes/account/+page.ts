import { redirect } from "@sveltejs/kit";
import { cloudApi } from "$lib/api-cloud";
import { loginBounce } from "$lib/utils/safe-next";
import type { PageLoad } from "./$types";

// Auth: redirects to /?next=/account if the user isn't signed in.
// `cloudApi.getMe` returns null on 401 (it swallows UnauthorizedError),
// so we check the result rather than catch.
export const load: PageLoad = async ({ fetch, url }) => {
	const user = await cloudApi.getMe({ fetch });
	if (!user) {
		throw redirect(303, loginBounce(url));
	}
	const { games } = await cloudApi.listGames({ fetch });
	return {
		user,
		games,
		meta: {
			title: "Settings - Per-Ankh",
			description: "Manage your Per-Ankh account settings.",
		},
	};
};
