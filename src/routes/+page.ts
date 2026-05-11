// Marketing landing + login surface for signed-out visitors. A signed-in
// user hitting / would see a "Login with Discord" CTA and assume they're
// signed out — instead, bounce them straight on. Honor `?next=` if
// present (an auth guard may have redirected them here mid-session-
// expiry); otherwise land them on /dashboard. Parent's load already
// fetched `user` via cloudApi.getMe, so this is free.
import { redirect } from "@sveltejs/kit";
import { safeNext } from "$lib/utils/safe-next";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ parent, url }) => {
	const { user } = await parent();
	if (user) throw redirect(303, safeNext(url.searchParams.get("next")));
	return {};
};
