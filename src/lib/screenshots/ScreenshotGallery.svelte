<script lang="ts">
	// The grid both screenshot surfaces render (issue #289, step 5): the
	// game-detail strip and the profile Screenshots tab. One component, because
	// the two differ only in what a tile has to say — the profile shows shots
	// from across all a user's games, so its tiles name and link the game,
	// while a game's own strip is already under that game's header.
	//
	// Tiles are the Worker's thumbnail URL, a single Cloudflare Images
	// transformation of the stored object; clicking one opens the stored object
	// itself, which is the only place the full 1600 px variant is ever served.
	// Neither URL is assembled here — see GameScreenshot in api-cloud.
	//
	// One grid at every width rather than one per surface. A game has at most
	// five screenshots, which is what lets its strip read as a row, and the
	// profile's set is bounded at a hundred; a single column ramp serves both
	// and is one thing to keep in step with the thumbnail's 8:5 shape.
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import {
		cloudApi,
		ApiError,
		UnauthorizedError,
		type GameScreenshot,
	} from "$lib/api-cloud";
	import FullscreenDialog from "$lib/ui/FullscreenDialog.svelte";
	import { confirmDialog } from "$lib/ui/confirm";
	import { loginBounce } from "$lib/utils/safe-next";
	import { formatGameTitle } from "$lib/utils/formatting";

	let {
		screenshots = $bindable(),
		canDelete = false,
		showGame = false,
	}: {
		// Bindable because a delete removes the tile OPTIMISTICALLY: Browser TTL
		// is 7200, so an uploader who waited for the round trip could keep
		// seeing their own deleted image for up to two hours — the one part of a
		// removal no purge reaches. The owner is also the parent's own state
		// after an upload, so the list has to live there either way.
		screenshots: GameScreenshot[];
		// The viewer owns these shots. Only ever true on a surface the owner is
		// looking at — there is no admin action here (that is step 6).
		canDelete?: boolean;
		// Name and link each tile's game. True on the profile tab, where a tile
		// is the only thing that says which game it came from.
		showGame?: boolean;
	} = $props();

	let lightbox = $state<GameScreenshot | null>(null);
	let lightboxOpen = $state(false);
	let error = $state<string | null>(null);
	// No in-flight state per tile: the removal is optimistic, so between the
	// confirm and the response there is no tile to disable.

	function open(shot: GameScreenshot): void {
		lightbox = shot;
		lightboxOpen = true;
	}

	function gameTitle(shot: GameScreenshot): string {
		const g = shot.game;
		if (!g) return "This game";
		// match_id: 0 is only consulted when name, nation and turns are all
		// missing — a degenerate save. The shape RecentSaveCard uses.
		return formatGameTitle({
			display_name: g.display_name,
			game_name: g.game_name,
			save_owner_nation: g.user_nation,
			total_turns: g.total_turns,
			match_id: 0,
		});
	}

	async function remove(shot: GameScreenshot): Promise<void> {
		const ok = await confirmDialog({
			title: "Delete screenshot?",
			message:
				"This permanently removes the image. It can't be undone — you'd have to upload it again.",
			confirmLabel: "Delete",
			destructive: true,
		});
		if (!ok) return;

		error = null;
		// Optimistic: out of the grid now, back at its own index if the request
		// fails, so a failure doesn't silently reorder the row.
		const index = screenshots.findIndex(
			(s) => s.screenshot_id === shot.screenshot_id,
		);
		if (index === -1) return;
		screenshots = screenshots.filter(
			(s) => s.screenshot_id !== shot.screenshot_id,
		);
		if (lightbox?.screenshot_id === shot.screenshot_id) lightboxOpen = false;

		try {
			await cloudApi.deleteScreenshot(shot.game_id, shot.screenshot_id);
		} catch (err) {
			screenshots = [
				...screenshots.slice(0, index),
				shot,
				...screenshots.slice(index),
			];
			if (err instanceof UnauthorizedError) {
				// The session expired under an owner-only control — the same
				// branch the uploader beside this takes, so the two controls in
				// one panel don't answer the same lapse differently. loginBounce
				// carries pathname + search, so the gallery comes back where it
				// was. The tile is already restored above, which is what the
				// bounced-and-returned page will render.
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic next-query construction; resolve()'s branded types don't admit dynamic search strings
				await goto(loginBounce(page.url));
				return;
			}
			error =
				err instanceof ApiError
					? err.message
					: "Couldn't delete that screenshot";
		}
	}
</script>

{#if error}
	<p class="mb-3 text-sm font-bold text-danger">{error}</p>
{/if}

<div
	class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
>
	{#each screenshots as shot (shot.screenshot_id)}
		<figure class="min-w-0">
			<div class="relative">
				<button
					type="button"
					onclick={() => open(shot)}
					class="block w-full cursor-pointer overflow-hidden rounded bg-surface-deep transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange"
					aria-label={shot.caption
						? `View screenshot: ${shot.caption}`
						: "View screenshot"}
				>
					<!-- 8:5, the thumbnail's own shape, so the box the grid reserves
					     is the box the image fills and no row resizes as tiles
					     arrive. The transformation already cropped to it; object-cover
					     is here for the rounding, not to crop. -->
					<img
						src={shot.thumb_url}
						alt={shot.caption ?? "Game screenshot"}
						width="640"
						height="400"
						loading="lazy"
						class="aspect-[8/5] w-full object-cover"
					/>
				</button>
				{#if canDelete}
					<!-- Always visible, never hover-only: a hover reveal has no
					     equivalent on touch, and this is the owner's only route to
					     making a game private again. -->
					<button
						type="button"
						onclick={() => remove(shot)}
						class="absolute right-1 top-1 cursor-pointer rounded bg-black/60 p-1 text-red-400 transition-colors hover:bg-black/80 hover:text-red-300"
						aria-label="Delete screenshot"
						title="Delete screenshot"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="block h-3.5 w-3.5"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="2"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</button>
				{/if}
			</div>
			{#if shot.caption || showGame}
				<figcaption class="mt-1 min-w-0 text-xs">
					{#if shot.caption}
						<p class="truncate text-tan" title={shot.caption}>{shot.caption}</p>
					{/if}
					{#if showGame}
						<a
							href={resolve("/games/[id]", { id: shot.game_id })}
							class="block truncate text-gray-400 hover:text-orange hover:underline"
						>
							{gameTitle(shot)}
						</a>
					{/if}
				</figcaption>
			{/if}
		</figure>
	{/each}
</div>

<FullscreenDialog bind:open={lightboxOpen} onclose={() => (lightbox = null)}>
	{#if lightbox}
		<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
			<!-- The stored object, full size — the only surface that serves it.
			     width/height are the stored variant's own, so the browser reserves
			     the right box while it loads. -->
			<img
				src={lightbox.url}
				alt={lightbox.caption ?? "Game screenshot"}
				width={lightbox.width}
				height={lightbox.height}
				class="max-h-full min-h-0 max-w-full rounded object-contain"
			/>
			{#if lightbox.caption}
				<p class="flex-none text-center text-sm text-tan">{lightbox.caption}</p>
			{/if}
		</div>
	{/if}
</FullscreenDialog>
