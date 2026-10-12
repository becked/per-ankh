// adapter-cloudflare with SSR. Public game pages need server-rendered
// <meta property="og:*"> tags so Discord/Slack/Twitter can unfurl shared
// URLs into preview cards.
export const ssr = true;
export const prerender = false;

import {
	cloudApi,
	type FeaturedVideo,
	type MyAdminTournamentEntry,
	type MyTournamentEntry,
	type UserMe,
} from "$lib/api-cloud";
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
// their own `meta` from a nested load — their `+page.ts`, or a `+layout.ts`
// shared by several views (the game route's) — SvelteKit merges parent +
// child data so the child's value wins. The root +layout.svelte renders one OG/
// Twitter block from `data.meta`.
export const load: LayoutLoad = async ({
	fetch,
}): Promise<{
	user: UserMe | null;
	meta: PageMeta;
	myTournaments: MyTournamentEntry[];
	adminTournaments: MyAdminTournamentEntry[];
	featuredVideos: FeaturedVideo[];
}> => {
	try {
		const user = await cloudApi.getMe({ fetch });
		// `getMe` genuinely gates the three reads below — all three are keyed on
		// the viewer, and the third on `is_admin`. Nothing gates the three on
		// each other: separate endpoints over separate tables, and none reads
		// another's output. So they are one wave, not three.
		//
		// That matters because this is a serial prefix on every page whose load
		// awaits `parent()`: each sequential call here is its own trip to the API
		// and its own D1 round trips behind that, which a visitor far from the
		// data pays in full (issue #292).
		//
		// `.catch()` per promise rather than around the group, because
		// `Promise.all` rejects on the first rejection and would discard two
		// good responses over one hiccup — the same correction the game route's
		// link reads carry (src/routes/games/[id]/+layout.ts).
		//
		// `myTournaments` drives the header dropdown (status != complete).
		// `adminTournaments` is a separate fetch (admin membership is its
		// own table). Both are nice-to-haves: failures fall through to
		// empty lists so the header still renders.
		//
		// my-tournaments / my-admin-tournaments are per-user membership lists,
		// relevant to any logged-in user. Skip the round-trips for signed-out
		// visitors.
		const myTournamentsPromise: Promise<MyTournamentEntry[]> = user
			? cloudApi
					.getMyTournaments({ fetch })
					.then((res) => res.tournaments.filter((t) => t.status !== "complete"))
					.catch(() => [])
			: Promise.resolve([]);
		const adminTournamentsPromise: Promise<MyAdminTournamentEntry[]> = user
			? cloudApi
					.getMyAdminTournaments({ fetch })
					.then((res) => res.tournaments.filter((t) => t.status !== "complete"))
					.catch(() => [])
			: Promise.resolve([]);
		// The site-admin featured set. Fetched once here — rather than by the
		// three page loads that render videos — because it's what the star toggle
		// on each VideoCard reads its state from, and because the alternative
		// (a per-viewer `featured` flag on /v1/creator-videos) would make an
		// edge-cached public response viewer-specific.
		//
		// Site admins only — the endpoint 404s for everyone else, so asking would
		// spend a round-trip to learn what `is_admin` already says. Still a
		// conditional rather than a fired-and-discarded read for that reason.
		const featuredVideosPromise: Promise<FeaturedVideo[]> = user?.is_admin
			? cloudApi.listFeaturedVideos({ fetch }).catch(() => [])
			: Promise.resolve([]);
		const [myTournaments, adminTournaments, featuredVideos] = await Promise.all(
			[myTournamentsPromise, adminTournamentsPromise, featuredVideosPromise],
		);
		return {
			user,
			meta: DEFAULT_META,
			myTournaments,
			adminTournaments,
			featuredVideos,
		};
	} catch {
		// Network errors etc. — header just renders signed-out state.
		// Page-level loads will surface real errors when they fire.
		return {
			user: null,
			meta: DEFAULT_META,
			myTournaments: [],
			adminTournaments: [],
			featuredVideos: [],
		};
	}
};
