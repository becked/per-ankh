// The global-stats surface: the chart catalog run over the whole public corpus
// rather than one user's library or one tournament's games.
//
// Signed-in only, and the payload is still the same bytes for everyone —
// is_public = 1 is the whole visibility rule server-side, and it already covers
// tournament games (linkTournamentMatch forces the flag), so no half of this
// page reads differently once you are through the door. The session is what
// gates spending a whole-corpus aggregation, and GET /v1/stats 401s without
// one; bouncing here means an anonymous visitor lands on login rather than on
// the page's own error state.
//
// The selection lives entirely in the URL, so a view is linkable and the
// browser's back button walks the slices — and `?next=` carries the whole
// selection through OAuth, so a shared link survives the login round trip.

import { redirect } from "@sveltejs/kit";
import { cloudApi } from "$lib/api-cloud";
import {
	globalSelectionLabel,
	parseGlobalPeriod,
	parseGlobalSlice,
	parseNationFacet,
} from "$lib/stats/global-facets";
import { rethrowRateLimit } from "$lib/utils/load-errors";
import { loginBounce } from "$lib/utils/safe-next";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
	// `cloudApi.getMe` returns null on 401 (it swallows UnauthorizedError), so
	// we check the result rather than catch — the same shape /account uses.
	const user = await cloudApi.getMe({ fetch });
	if (!user) {
		throw redirect(303, loginBounce(url));
	}

	// Parsed here rather than read raw, so an unknown ?slice= or an off-roster
	// ?nation= lights the control the Worker actually answered with instead of
	// leaving the row pointing at a selection the bundle isn't for.
	const slice = parseGlobalSlice(url.searchParams.get("slice"));
	const nation = parseNationFacet(url.searchParams.get("nation"));
	const period = parseGlobalPeriod(url.searchParams.get("period"));

	try {
		const bundle = await cloudApi.getGlobalStats({
			fetch,
			slice,
			nation,
			period,
		});
		const selection = globalSelectionLabel(slice, nation, period);
		return {
			bundle,
			slice,
			nation,
			period,
			meta: {
				// Constant, unlike the sibling stats surfaces: their varying
				// segment names the entity the page belongs to (a tournament, a
				// game), where this page's corpus is the whole site and the only
				// thing that varies is which view of it you are looking at. A tab
				// that renames itself as you work the facet row is the selection
				// leaking into the page's identity — the facet row and the
				// heading already say which slice you are on.
				title: "Global Stats - Per-Ankh",
				// The description still names the selection, so a shared link
				// unfurls as the view it points at rather than as the bare page.
				description: `Aggregate Old World statistics across every public game on Per-Ankh: ${selection}.`,
			},
		};
	} catch (err) {
		// /stats spends its own per-IP budget (not anon_read), so a 429 here
		// means this surface alone was hammered. Same remedy as everywhere
		// else: wait out the rolling hour.
		rethrowRateLimit(err);
		throw err;
	}
};
