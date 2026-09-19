// The player-profile page's load, shared by the two routes that serve it:
// /users/[user_id] (the permanent permalink) and /u/[slug] (the pretty URL).
// They render the same page from the same payload and differ only in how
// they resolve the profile — and in the fetch ordering that difference allows,
// which is why the orchestration stays in each +page.ts and everything that
// follows from a resolved profile lives here.

import { error, redirect } from "@sveltejs/kit";
import {
	ApiError,
	cloudApi,
	UnauthorizedError,
	type CollectionsListResponse,
	type UserProfile,
} from "$lib/api-cloud";
import { rethrowRateLimit } from "$lib/utils/load-errors";
import { loginBounce } from "$lib/utils/safe-next";
import type { ChartBundle, UserScope } from "$lib/stats/types";

const FIRST_PAGE_SIZE = 50;
const TABS = new Set([
	"overview",
	"stats",
	"games",
	"videos",
	"tournaments",
	"opponents",
]);
const SCOPE_KEYWORDS = new Set(["public", "vs_ai", "mp", "tournament"]);

// The shape a stored slug has. Mirrors the Worker's by-slug route regex
// (cloud/src/index.ts) — which is the claim format from
// cloud/src/schemas/user.ts, so nothing outside it can ever be a stored slug.
// The /u/ route tests it to 404 a junk URL without a round trip, the same way
// the id route tests the nanoid shape.
export const USER_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

// Scope row: one selection feeding the bundle and the games list, so all tabs
// agree on the in-scope set. Read before the stats fetch (it's a request
// parameter), hence its own export rather than a field of the builder below.
export function profileScope(url: URL): UserScope {
	const scopeRaw = url.searchParams.get("scope");
	return scopeRaw && (SCOPE_KEYWORDS.has(scopeRaw) || /^\d+$/.test(scopeRaw))
		? scopeRaw
		: "all";
}

// Everything downstream of a resolved profile: tab selection, the tab-lazy
// payloads, and the page's data object. Both routes return this verbatim, so
// the page — and its OG meta — can't drift between the two URLs.
export async function buildProfilePage(args: {
	fetch: typeof globalThis.fetch;
	url: URL;
	profile: UserProfile;
	collectionsRes: CollectionsListResponse;
	bundle: ChartBundle;
	isOwner: boolean;
	scope: UserScope;
}) {
	const { fetch, url, profile, collectionsRes, bundle, isOwner, scope } = args;
	const targetUserId = profile.user_id;

	const tabRaw = url.searchParams.get("tab");

	// Which tabs exist at all. Both are profile-level facts, so they also decide
	// where a visitor lands, not just what renders — hence read before the tab.
	const hasChannels = profile.channels.length > 0;
	// The flag is "holds a match OR has cast", so a dedicated caster who never
	// plays still gets the tab.
	const isTournamentParticipant = profile.tournament_participant;

	// A player whose tournament record is their whole presence here — every
	// save of their matches was uploaded by the opponent — would otherwise land
	// on an Overview built from a corpus they have none of. Their record is the
	// only populated surface, so it's the one worth opening on. total_games is
	// the profile's all-time count (public-only for a visitor), so this reads
	// the same way the Games tab will.
	const defaultTab =
		isTournamentParticipant && profile.summary.total_games === 0
			? "tournaments"
			: "overview";
	let tab = tabRaw && TABS.has(tabRaw) ? tabRaw : defaultTab;

	// A stale link to a tab this profile doesn't have falls back to the same tab
	// a bare URL opens on — never to a hidden one, since defaultTab is only
	// "tournaments" when that tab exists.
	if (tab === "videos" && !hasChannels) tab = defaultTab;
	if (tab === "tournaments" && !isTournamentParticipant) tab = defaultTab;
	// ?tab=opponents on someone else's profile — a shared link, or a guess —
	// lands on their Overview rather than on a tab that isn't theirs to see.
	if (tab === "opponents" && !isOwner) tab = defaultTab;

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

	// Fetch recent videos only when the Videos tab is active.
	const videos =
		tab === "videos"
			? await cloudApi.getUserVideos(targetUserId, { fetch })
			: [];

	// Same lazy load for the tournament record — one request covering
	// matches and casts, only when that tab is open.
	const tournamentRecord =
		tab === "tournaments"
			? await cloudApi.getUserTournaments(targetUserId, { fetch })
			: null;

	// And for the owner's suggested opponents. The endpoint is /users/me/… —
	// there is no by-id form, which is what makes this tab impossible to serve
	// for anyone but its owner however the URL is written.
	const suggestions =
		tab === "opponents" ? await cloudApi.getMyOpponents({ fetch }) : null;

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
		hasChannels,
		videos,
		isTournamentParticipant,
		tournamentRecord,
		suggestions,
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
}

// What ProfilePage.svelte renders — both routes' PageData.
export type ProfilePageData = Awaited<ReturnType<typeof buildProfilePage>>;

// Shared failure mapping for both routes: an anonymous visitor hitting a
// session-required sub-fetch bounces to login, a spent read budget is a 429, a
// missing user is a 404, and everything else — including SvelteKit's own
// redirect()/error() throws, which is what carries the id route's 307 out —
// propagates untouched.
//
// The 429 reaches here through the Tournaments tab: getUserTournaments draws on
// the per-IP tournament_view budget, the same one the /tournaments pages spend.
export function rethrowProfileLoadError(err: unknown, url: URL): never {
	if (err instanceof UnauthorizedError) {
		throw redirect(303, loginBounce(url));
	}
	rethrowRateLimit(err);
	if (err instanceof ApiError && err.status === 404) {
		throw error(404, "User not found");
	}
	throw err;
}
