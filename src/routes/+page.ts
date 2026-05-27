// Marketing landing + discovery feed — served to everyone, signed in or
// out. Loads the active tournaments list (public read) and the most
// recent shared saves (anonymous endpoint). Signed-in users see the
// same page; the login card swaps to a "Go to library" CTA pointing
// at their /users/[user_id] profile.
import { redirect } from "@sveltejs/kit";
import { cloudApi } from "$lib/api-cloud";
import { safeNext } from "$lib/utils/safe-next";
import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch, parent, url }) => {
	const { user } = await parent();

	// Belt-and-suspenders: an already-authenticated viewer who lands on a
	// `/?next=…` bounce URL (a stale/bookmarked link, or a live session in
	// another tab) should be forwarded to their destination rather than left on
	// the home page. The normal anon→login→callback path never reaches here —
	// the callback navigates straight to the unwrapped `next`. Skip home targets
	// so a self-referential `/?next=…` can't loop.
	const nextParam = url.searchParams.get("next");
	if (user && nextParam) {
		const target = safeNext(nextParam);
		if (target !== "/" && !target.startsWith("/?")) {
			throw redirect(303, target);
		}
	}

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
