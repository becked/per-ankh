// Marketing landing is for signed-out visitors. A logged-in user
// hitting / would see a "Login" CTA and assume they're signed out —
// instead, bounce them straight to /dashboard. Parent's load already
// fetched `user` via cloudApi.getMe, so this is free.
import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ parent }) => {
	const { user } = await parent();
	if (user) throw redirect(303, "/dashboard");
	return {};
};
