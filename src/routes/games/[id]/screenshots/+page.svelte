<script lang="ts">
	// A game's screenshots, the third of its views — the grid that used to be a
	// panel on the analyst view. It shares the [id] layout's load (no load of
	// its own) and the header above it, so switching to it makes no request:
	// the list is the one the layout already read, held in the shared state the
	// camera in that header writes to (screenshots-context).
	import type { PageData } from "./$types";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import GameHeader from "$lib/game-detail/GameHeader.svelte";
	import { getGameScreenshots } from "$lib/game-detail/screenshots-context.svelte";
	import ScreenshotGallery from "$lib/screenshots/ScreenshotGallery.svelte";

	let { data }: { data: PageData } = $props();
	const game = $derived(data.game);
	const screenshots = getGameScreenshots();
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
				<!-- The tray the tiles rest on — `surface`, the step a Panel sits at,
				     but without a Panel's heading: the segment in the toggle above
				     already reads "Screenshots", and this view holds nothing else
				     for a heading to tell apart.
				     The empty state is reachable by link alone, on a game whose
				     screenshots have all been deleted — the toggle offers no segment
				     for an empty one. -->
				<section class="rounded-lg bg-surface p-3">
					{#if screenshots.list.length === 0}
						<div class="py-8 text-center text-sm text-gray-400">
							No screenshots.
						</div>
					{:else}
						<ScreenshotGallery
							bind:screenshots={screenshots.list}
							canDelete={data.isOwner}
						/>
					{/if}
				</section>
			</div>
		</div>
	</main>
</div>
