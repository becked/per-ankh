// Marketing landing + discovery feed — served to everyone, signed in or
// out. Loads the most recent shared saves (anonymous endpoint) plus the
// video feeds. Signed-in users see the same page, minus the sign-in
// call to action.
import { redirect } from "@sveltejs/kit";
import { cloudApi } from "$lib/api-cloud";
import type {
	CreatorVideo,
	FeaturedVideo,
	PlayedGamesRow,
	StandingsResponse,
	TournamentDetail,
	TournamentMatch,
	TournamentVideo,
	UserMe,
} from "$lib/api-cloud";
import { videoKey } from "$lib/featured-videos.svelte";
import { cognomenName } from "$lib/utils/formatting";
import { rethrowRateLimit } from "$lib/utils/load-errors";
import { safeNext } from "$lib/utils/safe-next";
// Route → route, and the only such import in the repo: the season window and
// the cognomen ladder are /players' definitions, and home now reads the same
// two boards /players does. Imported rather than moved to $lib because nothing
// about them has stopped being /players' — and it introduces no
// $lib → src/routes edge, of which there are none: what crosses into
// $lib/home is plain props derived here.
import { RUNGS } from "./players/ladder";
import { allSeasons } from "./players/seasons";
import type { PageLoad } from "./$types";

// The tournament the home hero features. Hardcoded, as it has been since the
// panel was a still image — the site runs one major event at a time, and
// picking "the current one" from the list is a guess the list can't make.
const FEATURED_TOURNAMENT_SLUG = "2026-community-tournament";

// Players shown in the season standings panel. Enough to see the shape of the
// board without turning a home panel into /players.
const SEASON_STANDINGS_ROWS = 8;

export interface FeaturedTournament {
	tournament: TournamentDetail;
	standings: StandingsResponse;
	matches: TournamentMatch[];
}

// The featured tournament, its standings and the still-unplayed half of its
// match schedule.
//
// Sequential then parallel, the same shape /tournaments/[slug]'s layout load
// uses: the slug buys the id, and the id buys the other two. Three reads, all
// on the tournament_view budget — home is a spender of it now, which is the
// exception cloud/src/tournament/limits.ts names.
//
// `status: "pending"` is the whole schedule the Upcoming panel can ever draw:
// partitionSchedule keeps pending matches and nothing else, so this is that
// filter moved to the Worker rather than a second, looser definition of what
// counts. It is the difference between the landing page carrying an event's
// whole record and carrying what is still to come — mid-Swiss, most of a
// tournament is decided matches, and a decided match hauls the heaviest
// `parts` of all.
//
// Best-effort as a unit. A tournament that 404s (renamed, deleted, not yet
// created) and a worker hiccup are the same answer here — the panel is absent
// and the row closes up — so nothing is gained by distinguishing them.
async function loadFeaturedTournament(
	fetch: typeof globalThis.fetch,
): Promise<FeaturedTournament | null> {
	try {
		const tournament = await cloudApi.getTournament(FEATURED_TOURNAMENT_SLUG, {
			fetch,
		});
		const [standings, matches] = await Promise.all([
			cloudApi.getTournamentStandings(tournament.tournament_id, { fetch }),
			cloudApi.getTournamentMatches(
				tournament.tournament_id,
				{ status: "pending" },
				{ fetch },
			),
		]);
		return { tournament, standings, matches: matches.matches };
	} catch {
		return null;
	}
}

// Where a player stands on the cognomen ladder, and what the next rung costs.
//
// Derived here rather than in the panel because RUNGS lives beside /players and
// $lib/home does not reach into routes. `next` is null at the top of the
// ladder; `current` is null below the first rung, which is where most signed-in
// visitors are early in a season — the panel's primary state, not its edge case.
export interface CognomenProgress {
	current: string | null;
	next: { name: string; games: number; remaining: number } | null;
}

function cognomenProgress(games: number): CognomenProgress {
	const reached = RUNGS.findLast((r) => games >= r.games);
	const next = RUNGS.find((r) => games < r.games);
	return {
		current: reached ? cognomenName(reached.type) : null,
		next: next
			? {
					name: cognomenName(next.type),
					games: next.games,
					remaining: next.games - games,
				}
			: null,
	};
}

// The signed-in viewer's own season, read off the board the panel beside it
// renders — one fetch, two panels.
export interface YourSeason {
	// The viewer's own name and avatar, carried across so the panel can lead
	// with them. Read from the session rather than the board row, which a
	// player with no games this season doesn't have.
	displayName: string;
	avatarUrl: string;
	// Position in the server's order, +1 — the same rank /players shows, which
	// is the board's own ordering (total, then who reached it first) rather
	// than anything recomputed here. Null for a player with no games this
	// season: they are not on the board, so they have no rank on it.
	rank: number | null;
	games: number;
	cognomen: CognomenProgress;
	// All-time totals, which the board's season window can't answer. Null when
	// the profile read failed or the account has no profile.
	allTimeGames: number | null;
	winRate: number | null;
}

function yourSeason(
	players: PlayedGamesRow[],
	user: UserMe,
	allTime: { total_games: number; win_rate: number | null } | null,
): YourSeason {
	const index = players.findIndex((p) => p.user_id === user.user_id);
	const games = index === -1 ? 0 : players[index].total;
	return {
		displayName: user.display_name,
		avatarUrl: user.avatar_url,
		rank: index === -1 ? null : index + 1,
		games,
		cognomen: cognomenProgress(games),
		allTimeGames: allTime?.total_games ?? null,
		winRate: allTime?.win_rate ?? null,
	};
}

// Cards in the home video strip. Each feed already arrives capped at this size
// from the Worker (MAX_CREATOR_FEED_VIDEOS / MAX_TOURNAMENT_FEED_VIDEOS), so
// the newest twelve of the two merged are always among them — and all three
// caps move together. Applied after the featured ones are moved to the front,
// so a star costs the strip nothing but reorders it.
const VIDEO_STRIP_SIZE = 12;

// One list, two sources: creator uploads (every user's linked channels, which
// the Worker narrows to titles naming Old World) interleaved with the uploads on
// every visible tournament's playlist (unfiltered — a tournament's own admins
// curated them). Newest first across both, uncapped — the caller caps.
//
// A video can legitimately be in both feeds — a caster who linked their channel,
// whose VOD an admin then added to the playlist — and two entries sharing a
// platform+id crash the strip's keyed {#each} with each_key_duplicate, so the
// first occurrence wins. Creators lead the concat because their entries always
// carry Per-Ankh identity, where a playlist entry only does when its uploader
// linked that channel.
// Newest first. The platforms hand us ISO-8601 instants, whose lexicographic
// order is chronological, so the strings compare directly.
function byNewest(a: TournamentVideo, b: TournamentVideo): number {
	return a.published_at < b.published_at ? 1 : -1;
}

function mergeVideoFeeds(
	creatorVideos: CreatorVideo[],
	tournamentVideos: TournamentVideo[],
): TournamentVideo[] {
	const seen = new Set<string>();
	return [...creatorVideos, ...tournamentVideos]
		.filter((v) => {
			const key = videoKey(v);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.sort(byNewest);
}

// The strip, featured first: a star promotes a video to the front of the feed
// rather than into a tile of its own, which is what it bought until now (the
// hero beside the stats lists). Newest-first still holds within each half.
//
// The featured snapshots are what render, not the feeds' own copies of them. A
// featured video outlives the feed it came from — a channel's RSS returns ~15
// entries — so the snapshot is the entry that is always there, and dropping the
// feed copy is also what keeps one video from rendering twice and crashing the
// keyed {#each} with each_key_duplicate.
function featuredFirst(
	merged: TournamentVideo[],
	featured: FeaturedVideo[],
): TournamentVideo[] {
	const keys = new Set(featured.map(videoKey));
	return [
		...[...featured].sort(byNewest),
		...merged.filter((v) => !keys.has(videoKey(v))),
	];
}

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
	// blank the home page. Failures fall through to empty — the section
	// just shows its empty-state copy.
	//
	// A spent read budget is the exception, on the one fetch that has one. The
	// empty state reads as "nothing has been shared lately", which is a different
	// and wrong answer to "you've made too many requests" — and it hides the
	// thing an operator most needs to see, since this page is the busiest reader
	// of the anon_read budget. Same rule as every sibling loader, via
	// rethrowRateLimit.
	//
	// The three video feeds and the curated screenshot strip are deliberately
	// outside the read budgets and answer 200 by construction — each handler
	// swallows its own upstream failures to an empty list — so there is no 429
	// for them to re-throw. The strip's read is the one screenshot read with no
	// budget, because it is viewer-independent and therefore edge-cacheable,
	// where the two galleries are neither.
	//
	// The season board is the asymmetry worth naming: /players re-throws its own
	// 429 because a spent budget there means the archive walk that spent it, and
	// the page has nothing else to show. Here it is one panel of eight, and
	// blanking the landing page over it would be the wrong trade — home swallows
	// it and drops the panel, like every other feed on the page bar the one
	// above.
	// The season in progress — allSeasons() grows by itself as time passes, so
	// the last entry is today's and no deploy rolls a season over.
	const seasons = allSeasons();
	const season = seasons[seasons.length - 1];
	const [
		recentRes,
		creatorVideos,
		tournamentVideos,
		featuredVideos,
		featuredScreenshots,
		featured,
		seasonBoard,
		homeSummary,
		profile,
	] = await Promise.all([
		cloudApi.listPublicRecent({ fetch }).catch((err: unknown) => {
			rethrowRateLimit(err);
			return { games: [] };
		}),
		cloudApi.getCreatorVideos({ fetch }).catch(() => []),
		cloudApi.getTournamentVideos({ fetch }).catch(() => []),
		cloudApi.getFeaturedVideos({ fetch }).catch(() => []),
		cloudApi.getFeaturedScreenshots({ fetch }).catch(() => []),
		loadFeaturedTournament(fetch),
		cloudApi
			.getPlayerLeaderboard({ fetch, since: season.since, until: season.until })
			.catch(() => ({ players: [] })),
		cloudApi.getHomeSummary({ fetch }).catch(() => ({ summary: null })),
		// All-time games and win rate, which the season board can't answer — and
		// the one read on this page that spends no budget at all
		// (GET /v1/users/:user_id neither gates nor counts). Skipped for an
		// anonymous visitor, who has no panel to feed.
		user
			? cloudApi.getUserProfile(user.user_id, { fetch }).catch(() => null)
			: null,
	]);

	const merged = mergeVideoFeeds(creatorVideos, tournamentVideos);

	return {
		recentGames: recentRes.games,
		featured,
		// The season standings panel and "Your season" read the same board: the
		// panel takes the top rows, the viewer's own line is looked up across the
		// whole of it, so a player ranked 40th still sees their number.
		season,
		seasonPlayers: seasonBoard.players.slice(0, SEASON_STANDINGS_ROWS),
		yourSeason: user
			? yourSeason(seasonBoard.players, user, profile?.summary ?? null)
			: null,
		homeSummary: homeSummary.summary,
		// The curated strip, already capped and ordered by the Worker — a star is
		// the whole selection here, so there is nothing to merge or re-sort and no
		// second cap to disagree with its LIMIT.
		screenshots: featuredScreenshots,
		// Featured videos lead the strip; the rest follow newest-first. Capped
		// after the promotion, so the strip still carries a full twelve.
		videos: featuredFirst(merged, featuredVideos).slice(0, VIDEO_STRIP_SIZE),
	};
};
