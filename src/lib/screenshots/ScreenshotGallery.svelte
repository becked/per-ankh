<script lang="ts">
	// The grid both screenshot surfaces render (issue #289, step 5): the
	// game-detail strip and the profile Screenshots tab. One component, because
	// the two differ only in what a tile has to say — the profile shows shots
	// from across all a user's games, so its tiles name and link the game,
	// while a game's own strip is already under that game's header.
	//
	// A tile can be `in_review`: the classifier queued it, and both reads send
	// such a row to its uploader alone. It badges itself and keeps its delete,
	// because it holds a quota slot and pins its game public until it is
	// either published by an admin or removed here.
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
	import {
		SCREENSHOT_REPORT_REASONS,
		SCREENSHOT_REPORT_REASON_LABELS,
		type ScreenshotReportReason,
	} from "$lib/screenshots/report-reasons";
	import { SvelteSet } from "svelte/reactivity";
	import FullscreenDialog from "$lib/ui/FullscreenDialog.svelte";
	import RadioGroup from "$lib/ui/RadioGroup.svelte";
	import RadioItem from "$lib/ui/RadioItem.svelte";
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
		// looking at. It also decides which control a tile offers: an owner
		// deletes, everyone else reports, and nobody is offered both — a
		// report on your own screenshot is refused by the endpoint anyway
		// (409 OWN_SCREENSHOT), since the delete is faster and permanent.
		// Admin actions are not here; they live on /admin, where the queue is.
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
		// A form left open on the previous image must not greet the next one.
		reportingId = null;
		reportError = null;
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

	// --- Report ------------------------------------------------------
	//
	// Inside the lightbox and nowhere else: you report an image after looking
	// at it, the tile's own corner is the owner's delete, and a reason picker
	// on every tile in a five-across grid would be a form per thumbnail.
	//
	// Reported ids rather than a boolean, because the lightbox moves between
	// screenshots without unmounting — a single flag would mark the next
	// image as reported too. Not persisted: a reload shows the control again,
	// which the endpoint handles (one report per reporter per screenshot, and
	// a repeat while it is open just corrects the reason).
	let reportingId = $state<string | null>(null);
	let reportReason = $state<ScreenshotReportReason>("not_old_world");
	let reportSending = $state(false);
	const reported = new SvelteSet<string>();
	// Its own error slot rather than `error` above: that one renders over the
	// grid, and a modal dialog makes everything outside it inert — so a
	// failure raised inside the lightbox has to render inside the lightbox.
	let reportError = $state<string | null>(null);

	function openReport(shot: GameScreenshot): void {
		reportingId = shot.screenshot_id;
		reportReason = "not_old_world";
		reportError = null;
	}

	async function sendReport(shot: GameScreenshot): Promise<void> {
		if (reportSending) return;
		reportSending = true;
		reportError = null;
		try {
			await cloudApi.reportScreenshot(
				shot.game_id,
				shot.screenshot_id,
				reportReason,
			);
			// Not optimistic, unlike the delete: nothing on screen changes
			// until the server has the report, and there is no tile to put
			// back if it fails.
			reported.add(shot.screenshot_id);
			reportingId = null;
		} catch (err) {
			if (err instanceof UnauthorizedError) {
				// Signed out, or the session expired under the control. The
				// same bounce the delete and the uploader take, so one panel
				// does not answer the same lapse three ways.
				// eslint-disable-next-line svelte/no-navigation-without-resolve -- dynamic next-query construction; resolve()'s branded types don't admit dynamic search strings
				await goto(loginBounce(page.url));
				return;
			}
			reportError =
				err instanceof ApiError ? err.message : "Couldn't send that report";
		} finally {
			reportSending = false;
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
				{#if shot.status === "in_review"}
					<!-- Only an uploader is ever sent a queued row, so this badge is
					     also the only thing on screen that says why nobody else can
					     see the tile. Bottom-left, clear of the delete above it. -->
					<span
						class="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-xs font-bold text-orange"
						title="A site admin will look at this before anyone else can see it"
					>
						In review
					</span>
				{/if}
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
			{#if !canDelete}
				<!-- The report path. Here rather than on the tile: a reason is a
				     claim about the image, so it is asked for where the image is
				     actually being looked at, and the grid stays a grid. -->
				<div class="flex-none text-center text-xs">
					{#if reported.has(lightbox.screenshot_id)}
						<p class="text-tan">Reported. An admin will review it.</p>
					{:else if reportingId === lightbox.screenshot_id}
						{@const shot = lightbox}
						<div
							class="mx-auto max-w-xs rounded-lg bg-surface p-3 text-left shadow-lg"
						>
							<p class="mb-2 font-bold text-tan">
								What's wrong with this screenshot?
							</p>
							<!-- value + onChange with a cast at the boundary, not
							     bind: — bits-ui RadioGroup is string-only, the shape
							     SignupPopover already maps at. -->
							<RadioGroup
								value={reportReason}
								onChange={(v) => (reportReason = v as ScreenshotReportReason)}
								disabled={reportSending}
								ariaLabel="Reason"
								class="space-y-1.5"
							>
								{#each SCREENSHOT_REPORT_REASONS as reason (reason)}
									<label
										class="flex cursor-pointer items-center gap-2 text-tan"
									>
										<RadioItem value={reason} />
										<span>{SCREENSHOT_REPORT_REASON_LABELS[reason]}</span>
									</label>
								{/each}
							</RadioGroup>
							{#if reportError}
								<p class="mt-2 font-bold text-danger">{reportError}</p>
							{/if}
							<div class="mt-3 flex items-center gap-2">
								<button
									type="button"
									onclick={() => sendReport(shot)}
									disabled={reportSending}
									class="cursor-pointer rounded bg-orange px-3 py-1 font-bold text-white hover:bg-orange/80 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-orange"
								>
									{reportSending ? "Sending…" : "Send report"}
								</button>
								<button
									type="button"
									onclick={() => (reportingId = null)}
									class="cursor-pointer rounded px-3 py-1 font-bold text-tan hover:bg-tan-hover"
								>
									Cancel
								</button>
							</div>
						</div>
					{:else}
						{@const shot = lightbox}
						<button
							type="button"
							onclick={() => openReport(shot)}
							class="cursor-pointer rounded px-3 py-1 font-bold text-tan hover:bg-tan-hover hover:text-orange"
						>
							Report
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</FullscreenDialog>
