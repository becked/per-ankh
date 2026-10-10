import { error, redirect } from "@sveltejs/kit";
import { cloudApi, type AdminGameFilterParams } from "$lib/api-cloud";
import { PARSER_VERSION } from "$lib/parser/types";
import { loginBounce } from "$lib/utils/safe-next";
import type { PageLoad } from "./$types";

// The sweeps run a section at a time, so the section lives in the URL: it
// survives a reload (the modals are client-side and a long sweep invites one)
// and is shareable between the two cards. Which params are present *is* the
// selection — no separate mode param to drift out of sync with them.
function filterFromUrl(url: URL): AdminGameFilterParams {
	const filter: AdminGameFilterParams = {};
	for (const key of ["user_id", "tournament_id", "from", "to"] as const) {
		const raw = url.searchParams.get(key);
		if (raw) filter[key] = raw;
	}
	return filter;
}

// Site-admin gate. Mirror the Worker's 404-on-not-admin so the route
// existence isn't broadcast to non-admins.
export const load: PageLoad = async ({ fetch, url }) => {
	const user = await cloudApi.getMe({ fetch });
	if (!user) {
		throw redirect(303, loginBounce(url));
	}
	if (!user.is_admin) {
		throw error(404, "Not found");
	}
	const filter = filterFromUrl(url);
	// Reparse acts on games whose parser is older than this build; reindex
	// acts on every game (re-running the D1 pivot from the blob is idempotent).
	// Both are narrowed to the selected section.
	//
	// The tournament list feeds the picker. Setup-phase tournaments the admin
	// doesn't co-admin are hidden from it, which costs nothing: their matches
	// aren't complete, so their section would be empty either way. The picked
	// owner's profile supplies the display name for a section restored from a
	// bare ?user_id.
	//
	// Both are labels, not the work: they degrade to an empty picker / a
	// nameless section rather than failing the page. The tournament list in
	// particular is IP-rate-limited (it's the public read), and a sweep must
	// not be blocked by a budget it doesn't spend.
	//
	// The featured set is the Featured tab's whole content, and is unaffected by
	// the section filters — it's a curated list, not a slice of the corpus. The
	// screenshot queue is the same: moderation spans every game, so a section
	// filter would hide rows that still need a decision.
	const [
		{ games: outOfDateGames },
		{ games: allGames },
		tournaments,
		owner,
		featuredVideos,
		screenshots,
	] = await Promise.all([
		cloudApi.adminListOutOfDate(PARSER_VERSION, { fetch, filter }),
		cloudApi.adminListAllGames({ fetch, filter }),
		cloudApi
			.listTournaments({ limit: 100 }, { fetch })
			.catch(() => ({ tournaments: [] })),
		filter.user_id
			? cloudApi.getUserProfile(filter.user_id, { fetch }).catch(() => null)
			: Promise.resolve(null),
		cloudApi.listFeaturedVideos({ fetch }),
		cloudApi.adminListScreenshots({ fetch }),
	]);
	return {
		user,
		outOfDateGames,
		allGames,
		filter,
		tournaments: tournaments.tournaments,
		ownerName: owner?.display_name ?? null,
		featuredVideos,
		screenshots,
		meta: {
			title: "Admin - Per-Ankh",
			description: "Per-Ankh site administration.",
		},
	};
};
