// Dashboard load — cross-game stats + the cloud user's full game list +
// per-collection counts. Sidebar (CloudGameSidebar) filters/searches the
// games list client-side; listGames is capped at 200 server-side, which
// is the de-facto ceiling for v1. If a user surpasses that, switch the
// sidebar to a server-side filter.

import { redirect } from "@sveltejs/kit";
import { cloudApi, UnauthorizedError } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, url }) => {
	try {
		// Tournament fetches degrade gracefully when the feature is unused —
		// catch swallows their errors so a tournament-table outage doesn't
		// break the dashboard. Re-throw UnauthorizedError so the outer
		// redirect still fires; otherwise we'd silently mask auth failures if
		// the other fetches ever stop throwing 401.
		const swallowExceptAuth =
			<T>(fallback: T) =>
			(err: unknown): T => {
				if (err instanceof UnauthorizedError) throw err;
				return fallback;
			};
		const [stats, gamesRes, collectionsRes, myTournamentsRes, myMatchesRes] =
			await Promise.all([
				cloudApi.getStats({ fetch }),
				cloudApi.listGames({ fetch }),
				cloudApi.listCollections({ fetch }),
				cloudApi
					.getMyTournaments({ fetch })
					.catch(swallowExceptAuth({ tournaments: [] })),
				cloudApi
					.getMyMatches({ fetch })
					.catch(swallowExceptAuth({ matches: [] })),
			]);
		return {
			stats,
			games: gamesRes.games,
			collections: collectionsRes.collections,
			publicCount: collectionsRes.public_count,
			myTournaments: myTournamentsRes.tournaments,
			myMatches: myMatchesRes.matches,
		};
	} catch (err) {
		if (err instanceof UnauthorizedError) {
			throw redirect(303, `/?next=${encodeURIComponent(url.pathname)}`);
		}
		throw err;
	}
};
