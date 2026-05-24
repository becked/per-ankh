// Legacy /dashboard URL. The library + stats cards moved to
// /users/[user_id] (see src/routes/users/[user_id]/+page.ts) so visitors
// can view any user's profile, not just their own. This load() resolves
// the current user from the layout and redirects to their canonical
// profile; anon visitors land back on the public home.

import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ parent, url }) => {
	const { user } = await parent();
	if (!user) {
		throw redirect(303, `/?next=${encodeURIComponent(url.pathname)}`);
	}
	// 308 (permanent) — the move is permanent and we want POST/etc. to
	// re-resolve at the new URL. SvelteKit honors 308 for client-side
	// navigation and external bookmarks alike.
	throw redirect(308, `/users/${user.user_id}${url.search}`);
};
