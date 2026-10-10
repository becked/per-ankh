<script lang="ts">
	import { untrack } from "svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import type { PageData } from "./$types";
	import { GameDetailView } from "$lib/game-detail";
	import GameHeader from "$lib/game-detail/GameHeader.svelte";
	import { getGameVisibility } from "$lib/game-detail/visibility-context.svelte";
	import ScreenshotGallery from "$lib/screenshots/ScreenshotGallery.svelte";
	import ScreenshotUploader from "$lib/screenshots/ScreenshotUploader.svelte";
	import Panel from "$lib/ui/Panel.svelte";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import type { GameScreenshot } from "$lib/api-cloud";

	let { data }: { data: PageData } = $props();
	const game = $derived(data.game);
	const gameId = $derived(page.params.id ?? "");

	// The game's screenshots, on the analyst view only — the map view shares
	// GameHeader but is a full-bleed map with no room for a panel, which is
	// also why the strip is loaded by +page.ts rather than the shared layout.
	// The lock's state comes from the [id] layout's shared visibility rather
	// than the load's `is_public`, so publishing a game from the header reveals
	// the picker without a reload (issue #289).
	const visibility = getGameVisibility();

	// Local, because both ends of the panel write to it: an accepted upload
	// prepends a tile and a delete removes one optimistically. Initialised at
	// construction, not in an $effect, so the SSR'd HTML carries the strip.
	// svelte-ignore state_referenced_locally
	let screenshots = $state<GameScreenshot[]>(data.screenshots);

	// Re-sync only when the route navigates to a different game — the shape
	// the layout uses for the visibility toggle, and for the same reason: an
	// invalidateAll() for the same game (a rename) would otherwise race a
	// delete that is still in flight and put its tile back.
	$effect(() => {
		data.game.game_details.match_id;
		untrack(() => {
			screenshots = data.screenshots;
		});
	});

	// Owners see the panel on a game with no screenshots — it is where the
	// picker lives, and on a private game the one line pointing at the lock.
	// Everyone else only sees it when there is something in it.
	const showPanel = $derived(data.isOwner || screenshots.length > 0);

	// Links to the old Map tab (/games/[id]#map) land on the map view, replacing
	// the entry rather than adding one. The view isn't mounted while the hash is
	// #map: its own hash effect would otherwise select a "map" tab that no
	// longer exists (an empty pane), and goto is async, so the URL still reads
	// #map when that effect runs. Not mounting it wins without depending on
	// effect order. page.url.hash reads "" during SSR.
	const isMapHash = $derived(page.url.hash === "#map");
	$effect(() => {
		if (isMapHash) {
			goto(resolve("/games/[id]/map", { id: gameId }), { replaceState: true });
		}
	});
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-screen-2xl">
				<GameHeader
					{game}
					isOwner={data.isOwner}
					collections={data.collections}
					tournamentLink={data.tournamentLink}
					challengeLink={data.challengeLink}
				/>
				{#if !isMapHash}
					{#if showPanel}
						<Panel title="Screenshots" class="mb-4">
							{#if screenshots.length > 0}
								<div class="mb-3">
									<ScreenshotGallery
										bind:screenshots
										canDelete={data.isOwner}
									/>
								</div>
							{/if}
							{#if data.isOwner}
								<!-- The picker is the strip's own control rather than a
								     panel of its own: one "Screenshots" section, with the
								     owner's way of adding to what it shows underneath it. -->
								<!-- `featured: false` is the one field the 201 doesn't
								     carry: a screenshot a moment old has never been
								     starred, and the admin star the strip renders reads
								     it. -->
								<ScreenshotUploader
									{gameId}
									isPublic={visibility.isPublic}
									onUploaded={(shot) =>
										(screenshots = [
											{ ...shot, featured: false },
											...screenshots,
										])}
								/>
							{/if}
						</Panel>
					{/if}
					<GameDetailView {game} />
				{/if}
			</div>
		</div>
	</main>
</div>
