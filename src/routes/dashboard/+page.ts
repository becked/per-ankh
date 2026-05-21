// Dashboard load — cross-game stats + the first page of the user's games
// for the sidebar + per-collection counts. Filter state lives in the URL
// (?collection_id, ?filter=public, ?q, ?nation, ?date). The sidebar
// paginates via infinite scroll on top of this first page.

import { redirect } from "@sveltejs/kit";
import { cloudApi, UnauthorizedError } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

const FIRST_PAGE_SIZE = 50;

export const load: PageLoad = async ({ fetch, url }) => {
	const filterParam = url.searchParams.get("filter");
	const filter = filterParam === "public" ? "public" : undefined;
	const collectionIdRaw = url.searchParams.get("collection_id");
	const collectionId =
		collectionIdRaw && /^\d+$/.test(collectionIdRaw)
			? Number(collectionIdRaw)
			: undefined;
	const q = url.searchParams.get("q")?.trim() || undefined;
	const nationRaw = url.searchParams.get("nation");
	const nation =
		nationRaw && /^[A-Z_]+$/.test(nationRaw) ? nationRaw : undefined;
	const dateRaw = url.searchParams.get("date");
	const date =
		dateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : undefined;

	try {
		const [stats, gamesRes, collectionsRes] = await Promise.all([
			cloudApi.getStats({ fetch }),
			cloudApi.listGames({
				fetch,
				limit: FIRST_PAGE_SIZE,
				offset: 0,
				collectionId,
				filter,
				q,
				nation,
				date,
			}),
			cloudApi.listCollections({ fetch }),
		]);
		return {
			stats,
			games: gamesRes.games,
			gamesTotal: gamesRes.total,
			pageSize: FIRST_PAGE_SIZE,
			collections: collectionsRes.collections,
			publicCount: collectionsRes.public_count,
			// Surface the resolved filter state so the sidebar can render its
			// active-filter chrome without re-parsing the URL on every render.
			activeFilter:
				filter === "public"
					? ("public" as const)
					: collectionId != null
						? collectionId
						: ("all" as const),
			selectedNation: nation ?? null,
			selectedDate: date ?? null,
			searchValue: q ?? "",
		};
	} catch (err) {
		if (err instanceof UnauthorizedError) {
			throw redirect(303, `/?next=${encodeURIComponent(url.pathname)}`);
		}
		throw err;
	}
};
