import { redirect } from "@sveltejs/kit";
import { cloudApi } from "$lib/api-cloud";
import { PARSER_VERSION } from "$lib/parser/types";
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
	// Two reparse surfaces in the Maintenance tab:
	//   - outOfDateGames: the whole out-of-date set (server-filtered +
	//     unpaginated), powering the bulk "reparse N games" button.
	//   - allGames: the library list (capped at the Worker's 500 max),
	//     powering the per-save "reparse this one" rows — these let the user
	//     force a reparse of a save that's already on the current version.
	const [
		{ games: outOfDateGames },
		{ games: allGames, total: totalGames },
		channels,
	] = await Promise.all([
		cloudApi.listOutOfDate(PARSER_VERSION, { fetch }),
		cloudApi.listGames({ limit: 500, fetch }),
		cloudApi.listMyChannels({ fetch }),
	]);
	return {
		user,
		outOfDateGames,
		allGames,
		totalGames,
		channels,
		meta: {
			title: "Settings - Per-Ankh",
			description: "Manage your Per-Ankh account settings.",
		},
	};
};
