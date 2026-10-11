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
	import { formatDate, formatGameTitle } from "$lib/utils/formatting";
	import { profileHref } from "$lib/utils/profile-href";
	import Breadcrumb, { type Crumb } from "$lib/Breadcrumb.svelte";
	import SegmentedNav from "$lib/ui/SegmentedNav.svelte";
	import ReimportButton from "$lib/ReimportButton.svelte";
	import AdminReimportButton from "$lib/AdminReimportButton.svelte";
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

	// Re-import banner: shown to owners when the stored parser_version is
	// older than the current build's PARSER_VERSION. The blob carries
	// parser_version through from the gzipped JSON in R2, so this works
	// without a separate API call. Hidden for anonymous viewers (public
	// games) and non-owner signed-in viewers (`isOwner` is false in both).
	const needsReparse = $derived(isNewer(PARSER_VERSION, game.parser_version));
	const isReimportAvailable = $derived(isOwner && needsReparse);

	// Site admins get the same banner on a *public* game they don't own, wired
	// to the admin reparse path (targets the original owner, reuses the
	// uploader's original nation choice, no re-prompt) — the same machinery as
	// the /admin reparse sweep, for one game. Private games they don't own
	// return 403 from getGame, so they never reach this page. `game.user_id`
	// is always present on a loaded game but typed optional, so the target
	// (owner id + uploader_nation) is derived here and gated null → the banner
	// only shows when reparse is actually actionable. uploader_nation is the
	// raw choice (null = observer), not the COALESCE'd display user_nation.
	// Owners keep the owner path above.
	const isAdmin = $derived(page.data.user?.is_admin ?? false);
	const adminReparseTarget = $derived.by(() => {
		if (isOwner || !isAdmin || !needsReparse || game.user_id == null)
			return null;
		return {
			game_id: gameId,
			game_name: game.game_details.game_name ?? null,
			uploader_nation: game.uploader_nation ?? null,
			user_id: game.user_id,
		};
	});

	// Effective game title — same derivation GameDetailView used for its old
	// H1. Forms the breadcrumb's leaf (current page) segment.
	const gameTitle = $derived(
		formatGameTitle({
			display_name: game.display_name ?? null,
			game_name: game.game_details.game_name,
			save_owner_nation:
				game.user_nation ??
				game.game_details.players.find((p) => p.is_human)?.nation ??
				null,
			total_turns: game.game_details.total_turns,
			match_id: game.game_details.match_id,
		}),
	);

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
</script>

<!-- Trail on the left, the view toggle centred, the actions and save date on
     the right. On lg+ the side columns are equal fractions, so the auto middle
     column sits on the page's centre line — the tournament header's
     2fr/auto/1fr (tournaments/[slug]/+layout.svelte) buys its longer names
     room on the left instead and lands the toggle right of centre. Either way
     the toggle keeps its place whatever the title's length; below lg it wraps
     as a flex row. -->
<div
	class="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 lg:grid lg:grid-cols-[1fr_auto_1fr]"
>
	<Breadcrumb {crumbs} class="min-w-0" />

	<SegmentedNav
		items={viewTabs}
		activeIndex={activeViewIndex}
		ariaLabel="Game views"
	/>

	<div class="flex flex-shrink-0 items-center gap-4 lg:justify-self-end">
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
		/>
		<p class="text-sm text-gray-200">
			{formatDate(game.game_details.save_date)}
		</p>
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

{#if isReimportAvailable || adminReparseTarget}
	<div
		class="mb-4 flex w-fit flex-wrap items-center gap-3 rounded-lg border border-surface bg-surface-sunken p-2 shadow-lg"
	>
		<p class="rounded bg-surface px-2.5 py-1 text-xs italic text-tan">
			This game was parsed with version {game.parser_version}. Reparse to use
			the latest version ({PARSER_VERSION}).
		</p>
		{#if isReimportAvailable}
			<ReimportButton {gameId} />
		{:else if adminReparseTarget}
			<AdminReimportButton target={adminReparseTarget} />
		{/if}
	</div>
{/if}
