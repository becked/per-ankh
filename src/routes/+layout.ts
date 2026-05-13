// adapter-cloudflare with SSR. Public game pages need server-rendered
// <meta property="og:*"> tags so Discord/Slack/Twitter can unfurl shared
// URLs into preview cards.
export const ssr = true;
export const prerender = false;

import { cloudApi, type MyTournamentEntry, type UserMe } from "$lib/api-cloud";
import { DEFAULT_META, type PageMeta } from "$lib/page-meta";
import type { LayoutLoad } from "./$types";

// Layout-level user load. Provides `data.user` to the cloud header so it
// can render the avatar/display_name (or "Sign in") on every page.
//
// Per-page auth guards stay where they are — those redirect on
// UnauthorizedError to /. The layout fetch is for chrome only; a
// null `user` here just renders the signed-out header without disrupting
// the page's own load.
//
// `meta` defaults are also exposed here. Pages override them by returning
// their own `meta` from `+page.ts` — SvelteKit merges parent + child data
// so the child's value wins. The root +layout.svelte renders one OG/
// Twitter block from `data.meta`.
export const load: LayoutLoad = async ({
	fetch,
}): Promise<{
	user: UserMe | null;
	meta: PageMeta;
	tournamentNotices: MyTournamentEntry[];
}> => {
	try {
		const user = await cloudApi.getMe({ fetch });
		// Tournament enrollment banner: only fetched for signed-in users, and
		// only the ones they haven't dismissed and that haven't completed.
		// Failures are swallowed — the banner is a nice-to-have, not load
		// bearing for any page.
		let notices: MyTournamentEntry[] = [];
		if (user) {
			try {
				const res = await cloudApi.getMyTournaments({ fetch });
				notices = res.tournaments.filter(
					(t) =>
						t.status !== "complete" && t.claim_banner_dismissed_at === null,
				);
			} catch {
				// fall through with empty list
			}
		}
		return { user, meta: DEFAULT_META, tournamentNotices: notices };
	} catch {
		// Network errors etc. — header just renders signed-out state.
		// Page-level loads will surface real errors when they fire.
		return { user: null, meta: DEFAULT_META, tournamentNotices: [] };
	}
};
