// Marketing landing + discovery feed — served to everyone, signed in or
// out. Loads the active tournaments list (public read) and the most
// recent shared saves (anonymous endpoint). Signed-in users see the
// same page; the login card swaps to a "Go to library" CTA pointing
// at their /users/[user_id] profile.
import { cloudApi } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, parent }) => {
	const { user } = await parent();

	// All fetches are best-effort: a transient worker hiccup shouldn't
	// blank the home page. Failures fall through to empty/null — the
	// section just shows its empty-state copy. The profile fetch only
	// fires when signed in (it feeds the right-rail stat boxes).
	const [recentRes, tournamentsRes, profile] = await Promise.all([
		cloudApi.listPublicRecent({ fetch }).catch(() => ({ games: [] })),
		cloudApi
			.listTournaments({ limit: 50 }, { fetch })
			.catch(() => ({ tournaments: [], limit: 0, offset: 0 })),
		user
			? cloudApi.getUserProfile(user.user_id, { fetch }).catch(() => null)
			: Promise.resolve(null),
	]);

	return {
		recentGames: recentRes.games,
		tournaments: tournamentsRes.tournaments,
		profileSummary: profile?.summary ?? null,
	};
};
