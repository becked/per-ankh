<script lang="ts">
	// A game's screenshots, the third of its views — a panel per shot, grown
	// out of the single panel they shared on the analyst view. It shares the
	// [id] layout's load (no load of its own) and the header above it, so
	// switching to it makes no request: the list is the one the layout already
	// read, held in the shared state both cameras write to (screenshots-context)
	// — the one in that header, and the one this view offers while it is empty.
	import { page } from "$app/state";
	import type { PageData } from "./$types";
	import GameHeader from "$lib/game-detail/GameHeader.svelte";
	import { getGameScreenshots } from "$lib/game-detail/screenshots-context.svelte";
	import { getGameVisibility } from "$lib/game-detail/visibility-context.svelte";
	import ScreenshotGallery from "$lib/screenshots/ScreenshotGallery.svelte";
	import ScreenshotUploadModal from "$lib/screenshots/ScreenshotUploadModal.svelte";
	import { SECONDARY_BTN } from "$lib/ui/classes";

	let { data }: { data: PageData } = $props();
	const game = $derived(data.game);
	const screenshots = getGameScreenshots();

	// What the empty view's own camera needs, on the same terms the header's
	// takes them: from the shared state, not from the load. The lock is
	// optimistic, so `data.game.is_public` is stale the moment the owner flips
	// it — and this is the prop that decides whether the picker appears at all,
	// since on a private game the uploader shows a note pointing at that lock
	// instead.
	const gameId = $derived(page.params.id ?? "");
	const visibility = getGameVisibility();
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
				{#if screenshots.list.length > 0}
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
						isOwner={data.isOwner}
						layout="panels"
						gameName={data.gameName}
					/>
				{/if}
				{#if data.isOwner}
					<!-- The modal is mounted whatever the list holds, and only the
					     empty state inside its trigger comes and goes. It has to
					     outlive the swap it causes: ScreenshotUploader sets its done
					     phase and calls onUploaded in the same breath, so the list is
					     already 1 by the time the DOM flushes — and a modal inside
					     the empty state would be destroyed, with the screen it was
					     about to paint, before `Added.` or the sentence a queued
					     upload gets could be read. -->
					<ScreenshotUploadModal
						{gameId}
						isPublic={visibility.isPublic}
						onUploaded={(shot) => screenshots.prepend(shot)}
					>
						{#snippet trigger({ props })}
							{#if screenshots.list.length === 0}
								{@render emptyState(props)}
							{/if}
						{/snippet}
					</ScreenshotUploadModal>
				{:else if screenshots.list.length === 0}
					{@render emptyState(null)}
				{/if}
			</div>
		</div>
	</main>
</div>

<!-- For the owner this is where the feature starts: their segment in the
     toggle above is always offered, so an empty view is the ordinary first
     visit rather than a dead end, and the camera it carries says in words what
     the header's 14 px glyph cannot. A visitor reaches an empty one by link
     alone, on a game whose screenshots have all been deleted — the toggle
     offers them no segment for it, and no camera either, which is why the
     trigger's props are what this takes.
     A `surface` box of its own, since there is no panel here for it to be
     inside. -->
{#snippet emptyState(triggerProps: Record<string, unknown> | null)}
	<section class="rounded-lg bg-surface p-3">
		<div class="flex flex-col items-center gap-3 py-8 text-center">
			<p class="text-sm text-gray-400">
				{data.isOwner ? "No screenshots yet." : "No screenshots."}
			</p>
			{#if triggerProps}
				<button {...triggerProps} type="button" class={SECONDARY_BTN}>
					Add a screenshot
				</button>
			{/if}
		</div>
	</section>
{/snippet}
