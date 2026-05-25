import { error, redirect } from "@sveltejs/kit";
import { cloudApi } from "$lib/api-cloud";
import { PARSER_VERSION } from "$lib/parser/types";
import type { PageLoad } from "./$types";

// Site-admin gate. Mirror the Worker's 404-on-not-admin so the route
// existence isn't broadcast to non-admins.
export const load: PageLoad = async ({ fetch, url }) => {
	const user = await cloudApi.getMe({ fetch });
	if (!user) {
		throw redirect(303, `/?next=${encodeURIComponent(url.pathname)}`);
	}
	if (!user.is_admin) {
		throw error(404, "Not found");
	}
	// Reparse acts on games whose parser is older than this build; reindex
	// acts on every game (re-running the D1 pivot from the blob is idempotent).
	const [{ games: outOfDateGames }, { games: allGames }] = await Promise.all([
		cloudApi.adminListOutOfDate(PARSER_VERSION, { fetch }),
		cloudApi.adminListAllGames({ fetch }),
	]);
	return { user, outOfDateGames, allGames };
};
