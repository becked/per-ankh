// User home load — a single scoped ChartBundle (feeds Overview + Stats)
// plus profile + collections for the scope row. The games-list first page
// is fetched only when the Games tab is active. Owner sees private+public;
// visitor / anon sees only the target's is_public=1 games (enforced
// server-side). Tab + scope + filter state all live in the URL.

import { error, redirect } from "@sveltejs/kit";
import { ApiError, cloudApi, UnauthorizedError } from "$lib/api-cloud";
import { loginBounce } from "$lib/utils/safe-next";
import type { UserScope } from "$lib/stats/types";
import type { PageLoad } from "./$types";

const FIRST_PAGE_SIZE = 50;
const TABS = new Set(["overview", "stats", "games"]);
const SCOPE_KEYWORDS = new Set(["public", "vs_ai", "mp", "tournament"]);

export const load: PageLoad = async ({ fetch, url, params, parent }) => {
	const targetUserId = params.user_id;
	if (!/^[A-Za-z0-9_-]{21}$/.test(targetUserId)) {
		throw error(404, "User not found");
	}

	const { user: viewer } = await parent();
	const isOwner = viewer?.user_id === targetUserId;

	const tabRaw = url.searchParams.get("tab");
	const tab = tabRaw && TABS.has(tabRaw) ? tabRaw : "overview";

	// Scope row: one selection feeding the bundle and the games list, so
	// all tabs agree on the in-scope set.
	const scopeRaw = url.searchParams.get("scope");
	const scope: UserScope =
		scopeRaw && (SCOPE_KEYWORDS.has(scopeRaw) || /^\d+$/.test(scopeRaw))
			? scopeRaw
			: "all";

	// Games-tab filters (only meaningful when tab === "games").
	const q = url.searchParams.get("q")?.trim() || "";
	const nationRaw = url.searchParams.get("nation");
	const nation = nationRaw && /^[A-Z_]+$/.test(nationRaw) ? nationRaw : null;
	const dateRaw = url.searchParams.get("date");
	const date = dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : null;
	const resultRaw = url.searchParams.get("result");
	const result: "win" | "loss" | null =
		resultRaw === "win" || resultRaw === "loss" ? resultRaw : null;
	const sort = url.searchParams.get("sort") ?? "date_desc";

	try {
		const [profile, collectionsRes, bundle] = await Promise.all([
			cloudApi.getUserProfile(targetUserId, { fetch }),
			cloudApi.listCollections({ fetch, userId: targetUserId }),
			cloudApi.getUserStats(targetUserId, { fetch, scope }),
		]);
		if (!profile) {
			throw error(404, "User not found");
		}

		// Fetch the first games page only when the Games tab is active —
		// Overview/Stats render entirely from the bundle.
		const gamesRes =
			tab === "games"
				? await cloudApi.listGames({
						fetch,
						userId: targetUserId,
						limit: FIRST_PAGE_SIZE,
						offset: 0,
						scope,
						q: q || undefined,
						nation: nation ?? undefined,
						result: result ?? undefined,
						date: date ?? undefined,
						sort,
					})
				: null;

		return {
			profile,
			meta: {
				title: `${profile.display_name} - Per-Ankh`,
				description: `${profile.display_name}'s Old World games and statistics on Per-Ankh.`,
			},
			isOwner,
			bundle,
			collections: collectionsRes.collections,
			scopeCounts: collectionsRes.scope_counts,
			tab,
			scope,
			category: url.searchParams.get("category"),
			// Games-tab state.
			games: gamesRes?.games ?? [],
			gamesTotal: gamesRes?.total ?? 0,
			pageSize: FIRST_PAGE_SIZE,
			q,
			nation,
			result,
			date,
			sort,
		};
	} catch (err) {
		if (err instanceof UnauthorizedError) {
			throw redirect(303, loginBounce(url));
		}
		if (err instanceof ApiError && err.status === 404) {
			throw error(404, "User not found");
		}
		throw err;
	}
};
