import { redirect } from "@sveltejs/kit";
import { cloudApi } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

// Account page load — needs the Discord identity (display_name, avatar,
// discord_id) and the linked OnlineIDs list. Both come from the cloud
// API; fetched in parallel because neither depends on the other.
//
// Auth: redirects to /login?next=/account if the user isn't signed in.
// `cloudApi.getMe` returns null on 401 (it swallows UnauthorizedError),
// so we check the result rather than catch.
export const load: PageLoad = async ({ fetch, url }) => {
	const [user, onlineIds] = await Promise.all([
		cloudApi.getMe({ fetch }),
		cloudApi.getMyOnlineIds({ fetch }).catch(() => [] as string[]),
	]);
	if (!user) {
		throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	}
	return { user, onlineIds };
};
