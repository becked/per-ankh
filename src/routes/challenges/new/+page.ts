// The create page parses the turn-1 save in a Web Worker, so it's client-only
// like /upload. Session-gated: anonymous visitors bounce to login.
import { redirect } from "@sveltejs/kit";
import { loginBounce } from "$lib/utils/safe-next";
import type { PageLoad } from "./$types";

export const ssr = false;

export const load: PageLoad = async ({ parent, url }) => {
	const { user } = await parent();
	if (!user) {
		throw redirect(303, loginBounce(url));
	}
	return {
		meta: {
			title: "New challenge - Per-Ankh",
			description: "Turn a turn-1 save into a challenge map.",
		},
	};
};
