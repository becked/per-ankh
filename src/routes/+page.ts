// Marketing landing + discovery feed — served to everyone, signed in or
// out. Loads the active tournaments list (public read) and the most
// recent shared saves (anonymous endpoint). Signed-in users see the
// same page; the login card swaps to a "Go to dashboard" CTA in the
// component.
import { cloudApi } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch }) => {
	// Both fetches are best-effort: a transient worker hiccup shouldn't
	// blank the home page. Failures fall through to empty arrays — the
	// section just shows its empty-state copy.
	const [recentRes, tournamentsRes] = await Promise.all([
		cloudApi.listPublicRecent({ fetch }).catch(() => ({ games: [] })),
		cloudApi
			.listTournaments({ limit: 50 }, { fetch })
			.catch(() => ({ tournaments: [], limit: 0, offset: 0 })),
	]);

	return {
		recentGames: recentRes.games,
		tournaments: tournamentsRes.tournaments,
	};
};
