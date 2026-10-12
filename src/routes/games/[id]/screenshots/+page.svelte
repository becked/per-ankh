<script lang="ts">
	// A game's screenshots, the third of its views — a panel per shot, grown
	// out of the single panel they shared on the analyst view. It shares the
	// [id] layout's load (no load of its own) and the header above it, so
	// switching to it makes no request: the list is the one the layout already
	// read, held in the shared state the camera in that header writes to
	// (screenshots-context).
	import type { PageData } from "./$types";
	import GameHeader from "$lib/game-detail/GameHeader.svelte";
	import { getGameScreenshots } from "$lib/game-detail/screenshots-context.svelte";
	import ScreenshotGallery from "$lib/screenshots/ScreenshotGallery.svelte";

	let { data }: { data: PageData } = $props();
	const game = $derived(data.game);
	const screenshots = getGameScreenshots();
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div class="flex-1 overflow-y-auto px-4 pb-8 pt-4">
			<div class="mx-auto max-w-screen-2xl">
				<GameHeader
					{game}
					isOwner={data.isOwner}
					collections={data.collections}
					tournamentLink={data.tournamentLink}
					challengeLink={data.challengeLink}
				/>
				{#if screenshots.list.length === 0}
					<!-- Reachable by link alone, on a game whose screenshots have all
					     been deleted — the toggle offers no segment for an empty one.
					     A `surface` box of its own, since there is no panel here for
					     it to be inside. -->
					<section class="rounded-lg bg-surface p-3">
						<div class="py-8 text-center text-sm text-gray-400">
							No screenshots.
						</div>
					</section>
				{:else}
					<!-- A panel per screenshot, with the picture beside what is known
					     about it: five at most on a game, which is what gives each one
					     the room its caption and its date need.
					     Straight onto the page, with no tray under them — the panels
					     ARE the cards, and `Panel`'s own ladder puts a `surface` card
					     on the page background. A tray would also have to be wider
					     than the capped grid it held, which is a well with a corner
					     standing empty. No heading either: the segment in the toggle
					     above already reads "Screenshots". -->
					<ScreenshotGallery
						bind:screenshots={screenshots.list}
						canDelete={data.isOwner}
						layout="panels"
						gameName={data.gameName}
					/>
				{/if}
			</div>
		</div>
	</main>
</div>
