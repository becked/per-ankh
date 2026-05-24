// The dedicated user-stats route was absorbed into the home page's Stats
// tab. Redirect old links to /users/[user_id]?tab=stats, mapping the old
// game-type filter (?game_type / legacy ?filter) onto the unified ?scope.

import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url, params }) => {
	const dest = new URL(`/users/${params.user_id}`, url.origin);
	dest.searchParams.set("tab", "stats");
	const legacyType =
		url.searchParams.get("game_type") ?? url.searchParams.get("filter");
	if (legacyType && legacyType !== "all")
		dest.searchParams.set("scope", legacyType);
	throw redirect(307, `${dest.pathname}${dest.search}`);
};
