<script lang="ts">
	// The header a game's views share — the analyst view (/games/[id]), the map
	// view (/games/[id]/map) and the screenshots view (/games/[id]/screenshots):
	// the breadcrumb, the toggle between the views, the actions, the save date,
	// and the reparse banner. Each page mounts its own; the visibility state the
	// lock binds to and the screenshot list the camera adds to both come from
	// the [id] layout (see visibility-context, screenshots-context).
	import { page } from "$app/state";
	import { resolve } from "$app/paths";
	import type {
		cloudApi,
		CollectionInfo,
		GameChallengeLink,
		GameTournamentLink,
	} from "$lib/api-cloud";
	import { isNewer } from "$lib/utils/semver";
	import { PARSER_VERSION } from "$lib/parser/types";
	import { formatDate } from "$lib/utils/formatting";
	import { profileHref } from "$lib/utils/profile-href";
	import Breadcrumb, { type Crumb } from "$lib/Breadcrumb.svelte";
	import SegmentedNav from "$lib/ui/SegmentedNav.svelte";
	import ReparseButton from "$lib/ReparseButton.svelte";
	import GameActions from "$lib/GameActions.svelte";
	import { getGameScreenshots } from "./screenshots-context.svelte";
	import { getGameVisibility } from "./visibility-context.svelte";

	let {
		game,
		isOwner,
		collections,
		tournamentLink,
		challengeLink,
	}: {
		game: Awaited<ReturnType<typeof cloudApi.getGame>>;
		isOwner: boolean;
		collections?: CollectionInfo[];
		tournamentLink: GameTournamentLink | null;
		challengeLink: GameChallengeLink | null;
	} = $props();

	// Cloud game id from URL — distinct from the in-game `xml_game_id`
	// which is the GameId attribute on the save's <Root> element.
	const gameId = $derived(page.params.id ?? "");

	const visibility = getGameVisibility();
	const screenshots = getGameScreenshots();

	// The game's views, and which one is showing — read from the route id (as
	// the tournament view tabs do), so the toggle's pill marks the right view in
	// the SSR'd first paint rather than sliding into place on hydration.
	//
	// Screenshots is the third only once the game has one: it is a view of the
	// uploads, so an empty segment would offer an empty page. The route itself
	// stays reachable, and showing it is the second half of the condition —
	// a link to it on a game whose screenshots have since been deleted would
	// otherwise leave the toggle with no segment for the page it is on.
	const isScreenshotsView = $derived(
		page.route.id === "/games/[id]/screenshots",
	);
	const viewTabs = $derived([
		{ href: resolve("/games/[id]", { id: gameId }), label: "Analysis" },
		{ href: resolve("/games/[id]/map", { id: gameId }), label: "Map" },
		...(screenshots.list.length > 0 || isScreenshotsView
			? [
					{
						href: resolve("/games/[id]/screenshots", { id: gameId }),
						label: "Screenshots",
					},
				]
			: []),
	]);
	const activeViewIndex = $derived(
		isScreenshotsView
			? 2
			: page.route.id === "/games/[id]/map"
				? 1
				: page.route.id === "/games/[id]"
					? 0
					: -1,
	);

	// Effective game title, forming the breadcrumb's leaf (current page)
	// segment. The [id] layout's own derivation, read off `page.data` the way
	// the root layout reads that load's `meta`: the <head>/OG title and the
	// screenshots view's lightbox heading are the same string, and one
	// derivation is what keeps the three of them from drifting apart.
	const gameTitle = $derived(page.data.gameName as string);

	// Canonical breadcrumb trail, derived from the game's own data so it's
	// stable across direct links, refreshes, and re-entry. A tournament game's
	// parent is its tournament; otherwise the parent is the uploader's profile.
	const crumbs = $derived.by((): Crumb[] => {
		const trail: Crumb[] = [{ label: "Home", href: resolve("/") }];
		if (tournamentLink) {
			trail.push({ label: "Tournaments", href: resolve("/tournaments") });
			trail.push({
				label: tournamentLink.tournament.name,
				href: resolve("/tournaments/[slug]", {
					slug: tournamentLink.tournament.slug,
				}),
			});
		} else if (challengeLink) {
			trail.push({ label: "Challenges", href: resolve("/challenges") });
			trail.push({
				label: `#${challengeLink.number} ${challengeLink.title}`,
				href: resolve("/challenges/[number]", {
					number: String(challengeLink.number),
				}),
			});
		} else if (game.user_id && game.user_display_name) {
			trail.push({
				label: game.user_display_name,
				href: profileHref({ user_id: game.user_id, slug: game.user_slug }),
			});
		}
		trail.push({ label: gameTitle });
		return trail;
	});

	// Reparse banner: shown when the stored parser_version is older than the
	// current build's PARSER_VERSION. The blob carries parser_version through
	// from the gzipped JSON in R2, so this works without a separate API call.
	// Hidden from anonymous viewers (public games) and non-admin non-owner
	// signed-in viewers.
	const needsReparse = $derived(isNewer(PARSER_VERSION, game.parser_version));
	const isAdmin = $derived(page.data.user?.is_admin ?? false);
	// One target for both callers, built here and gated null so the banner
	// only shows when a reparse is actually actionable. The seat is the stored
	// `uploader_player_index` (null = observer), posted back verbatim — not a
	// nation, which names two seats in a mirror matchup. The label is the same
	// effective title the breadcrumb leaf uses.
	const reparse = $derived.by(() => {
		if (!needsReparse) return null;
		const target = {
			game_id: gameId,
			game_name: gameTitle,
			uploader_player_index: game.uploader_player_index ?? null,
		};
		if (isOwner) return { target, adminMode: false };
		// Site admins get the same banner on a *public* game they don't own,
		// wired to the admin path: the reparse posts on behalf of the original
		// owner, so the game keeps its owner and nation. Private games they
		// don't own return 403 from getGame, so they never reach this page.
		// `game.user_id` is always present on a loaded game but typed
		// optional, so a missing id drops the banner rather than building a
		// target the admin endpoint can't use.
		if (!isAdmin || game.user_id == null) return null;
		return { target: { ...target, user_id: game.user_id }, adminMode: true };
	});
</script>

<!-- Two rows: the trail and the action cluster share the top one, the view
     toggle sits centred on a row of its own beneath. The trail has the full
     width of its row less the cluster, so a long game name doesn't wrap. (The
     tournament header keeps its toggle inline, in the centre column of a
     three-column grid — tournaments/[slug]/+layout.svelte.) -->
<div class="mb-4 flex flex-col gap-2">
	<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
		<Breadcrumb {crumbs} class="min-w-0" />

		<div class="flex flex-shrink-0 items-center gap-4">
			<!--
				currentCollectionId is omitted: with the sidebar gone we no
				longer load the games list here, so the "already in this
				collection" checkmark is unavailable. The move action still
				works; the Games-tab row menu shows the indicator instead.
			-->
			<GameActions
				{gameId}
				{isOwner}
				bind:isPublic={visibility.isPublic}
				{screenshots}
				{collections}
				displayName={game.display_name ?? null}
				gameName={game.game_details.game_name ?? null}
				players={game.player_roster}
				uploaderPlayerIndex={game.uploader_player_index ?? null}
			/>
			<p class="text-sm text-gray-200">
				{formatDate(game.game_details.save_date)}
			</p>
		</div>
	</div>

	<!-- SegmentedNav is a grid of equal columns, so on its own row it would
	     stretch the full width; the wrapper holds it to its labels and centres
	     it on the page's centre line, where the three-column grid had it. -->
	<div class="mx-auto w-fit">
		<SegmentedNav
			items={viewTabs}
			activeIndex={activeViewIndex}
			ariaLabel="Game views"
		/>
	</div>
</div>

{#if challengeLink}
	<div
		class="mb-4 flex w-fit flex-wrap items-center gap-3 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg"
	>
		<p class="rounded bg-surface px-2.5 py-1 text-xs text-tan">
			<a
				href={resolve("/challenges/[number]", {
					number: String(challengeLink.number),
				})}
				class="font-bold hover:text-orange"
			>
				Challenge #{challengeLink.number}: {challengeLink.title}
			</a>
			— scores T{challengeLink.score_turn} · rank #{challengeLink.rank}
		</p>
	</div>
{/if}

{#if reparse}
	<div
		class="mb-4 flex w-fit flex-wrap items-center gap-3 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg"
	>
		<p class="rounded bg-surface px-2.5 py-1 text-xs italic text-tan">
			This game was parsed with version {game.parser_version}. Reparse to use
			the latest version ({PARSER_VERSION}).
		</p>
		<ReparseButton target={reparse.target} adminMode={reparse.adminMode} />
	</div>
{/if}
