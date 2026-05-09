// /games used to be a flat list; that surface has been replaced by the
// game sidebar on /dashboard. 301 (rather than 404) protects deep links
// and old bookmarks.

import { redirect } from "@sveltejs/kit";
import type { PageLoad } from "./$types";

export const load: PageLoad = () => {
	throw redirect(301, "/dashboard");
};
