<script lang="ts">
	// Both screenshot surfaces (issue #289, step 5): a game's Screenshots view
	// and the profile Screenshots tab. One component, because the two differ
	// only in how much room a shot gets and in what it has to say — the
	// profile shows shots from across all a user's games, so it names and
	// links the game, while a game's own view is already under that game's
	// header.
	//
	// Two layouts over one set of behaviour, chosen by `layout`. `panels`
	// gives each screenshot a `surface` card with the picture on the left and
	// what is known about it on the right — the caption its uploader wrote,
	// when it was uploaded, its controls — which is the shape the tournament
	// Videos view gives a part's angles and the admin queue gives a shot under
	// judgement. `grid` is the dense tile ramp. Both ramp their columns with
	// the width — panels one to three, tiles two to five — so what separates
	// them is how wide a column is allowed to get, not whether there is one.
	// The lightbox, the delete, the report and the star are the same code
	// either way; what the two differ in is an item's chrome and where its
	// controls sit.
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
	// Each layout keeps one column ramp at every width rather than one per
	// surface: the profile's set is bounded at a hundred, a game's at five,
	// and one ramp apiece is one thing to keep in step with the thumbnail's
	// 8:5 shape.
	//
	// Both layouts are sized to that thumbnail, and that is a constraint
	// rather than a preference — it is the feature's ONLY Cloudflare Images
	// transformation, and the count is bounded by the free tier rather than by
	// taste (public-urls.ts has the arithmetic). So a panel's picture stays
	// inside what 640 px covers at 2x instead of minting a second variant for
	// the wider box it could otherwise fill.
	//
	// Three controls, one per viewer: the owner's delete, everyone else's
	// report, and a site admin's star for the home strip.
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
	import StarMark from "$lib/ui/StarMark.svelte";
	import { confirmDialog } from "$lib/ui/confirm";
	import { loginBounce } from "$lib/utils/safe-next";
	import { formatGameTitle, formatLongDate } from "$lib/utils/formatting";

	let {
		screenshots = $bindable(),
		canDelete = false,
		showGame = false,
		layout = "grid",
		gameName,
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
		// The admin star is independent of it — it comes from `page.data` and
		// not from a prop, so an admin looking at their own gallery gets both.
		canDelete?: boolean;
		// Name and link each tile's game. True on the profile tab, where a tile
		// is the only thing that says which game it came from.
		showGame?: boolean;
		// How much room one screenshot gets: a card each, picture beside
		// description, or the dense tile ramp. The grid is the default because
		// it is the denser of the two, which is what the surface bounded at a
		// hundred shots needs; a game's own view, capped at five, asks for
		// panels.
		layout?: "grid" | "panels";
		// The game these shots are of, as its own view names it: the lightbox is
		// headed by the game, and a game's list payload carries no game fields
		// per row — the list is one game's — so that surface passes the name the
		// page already derived. The profile tab passes nothing: its rows span
		// games and each one names its own.
		gameName?: string;
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

	// The label for whatever opens the full-size picture: the tile itself in
	// the grid, the whole panel in the panel layout. One function, because the
	// two controls are the same control in different chrome.
	function viewLabel(shot: GameScreenshot): string {
		return shot.caption
			? `View screenshot: ${shot.caption}`
			: "View screenshot";
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

	// --- Admin star --------------------------------------------------
	//
	// Puts a screenshot on the home strip, or takes it off: the `star` /
	// `unstar` decision the moderation queue on /admin also makes, offered
	// where an admin actually comes across a screenshot. The queue lists only
	// what needs a decision and what is already starred, so a published,
	// unreported shot — most of what is worth featuring — could not be reached
	// from it at all.
	//
	// Read off `page` rather than threaded down as a prop: both surfaces render
	// this grid from a list and neither has another reason to know who is
	// looking, which is why FeaturedStar (the same control for videos) reads it
	// directly too.
	const canStar = $derived(page.data.user?.is_admin === true);

	// Which tiles are mid-write: a set rather than one flag, because this grid
	// is many tiles where FeaturedStar is one card, and two stars are two rows
	// — curating a strip means pressing several in a row, so a press on one
	// tile must not block the next. Only the pressed star disables, which is
	// also what keeps it from being pressed twice. (The delete needs no slot
	// at all: its tile is gone before the request goes out.)
	const starring = new SvelteSet<string>();

	function setFeatured(screenshotId: string, featured: boolean): void {
		screenshots = screenshots.map((s) =>
			s.screenshot_id === screenshotId ? { ...s, featured } : s,
		);
	}

	async function toggleStar(shot: GameScreenshot): Promise<void> {
		if (starring.has(shot.screenshot_id)) return;
		const next = !shot.featured;
		error = null;
		// Optimistic, like the delete above and like the video star this
		// mirrors: the star fills on the press and goes back on failure.
		// `featured` is a boolean, so the flip writes the whole truth of the
		// field — the timestamp the home strip orders by stays the server's.
		setFeatured(shot.screenshot_id, next);
		starring.add(shot.screenshot_id);
		try {
			await cloudApi.adminModerateScreenshot(
				shot.screenshot_id,
				next ? "star" : "unstar",
			);
		} catch (err) {
			setFeatured(shot.screenshot_id, !next);
			// Prefixed with what failed, the way the moderation table reports the
			// same endpoint's refusals — not bare like the delete's, because the
			// one refusal this control can meet without a concurrent change is
			// the admin gate's `404 Not found`, which says nothing on its own.
			// No login bounce for that lapse either: the endpoint answers 404
			// rather than 401 to keep its existence unadvertised, so it arrives
			// as an ApiError and the UnauthorizedError branch the delete and the
			// report take would be dead code here.
			error = `Couldn't ${next ? "star" : "unstar"} that screenshot: ${
				err instanceof Error ? err.message : err
			}`;
		} finally {
			starring.delete(shot.screenshot_id);
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

{#snippet thumbnail(shot: GameScreenshot)}
	<!-- 8:5, the thumbnail's own shape, so the box the layout reserves is the
	     box the image fills and nothing resizes as tiles arrive. The
	     transformation already cropped to it; object-cover is here for the
	     rounding, not to crop. -->
	<img
		src={shot.thumb_url}
		alt={shot.caption ?? "Game screenshot"}
		width="640"
		height="400"
		loading="lazy"
		class="aspect-[8/5] w-full object-cover"
	/>
{/snippet}

{#snippet picture(shot: GameScreenshot, className: string)}
	<!-- The grid's picture is its own control: a tile there is the picture and
	     a line of text under it, so there is nothing else of it to press. A
	     panel has a column of text beside the picture and presses as one card
	     — the panel layout wraps the thumbnail itself and stretches one button
	     over the whole figure instead. -->
	<button
		type="button"
		onclick={() => open(shot)}
		class="block cursor-pointer overflow-hidden rounded bg-surface-deep transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange {className}"
		aria-label={viewLabel(shot)}
	>
		{@render thumbnail(shot)}
	</button>
{/snippet}

{#snippet inReviewBadge(className: string)}
	<!-- Only an uploader is ever sent a queued row, so this is also the only
	     thing on screen that says why nobody else can see the screenshot. In
	     the grid it rides the picture's bottom-left corner, clear of the
	     delete above it; in a panel it is a badge in the text column, which is
	     where that layout keeps everything it has to say. -->
	<span
		class="font-bold text-orange {className}"
		title="A site admin will look at this before anyone else can see it"
	>
		In review
	</span>
{/snippet}

{#snippet gameLink(shot: GameScreenshot, className: string)}
	<!-- Into that game's screenshots view, not its analyst view: the link is on
	     a screenshot, and that is the view the screenshot is on. -->
	<a
		href={resolve("/games/[id]/screenshots", { id: shot.game_id })}
		class="block truncate text-gray-400 hover:text-orange hover:underline {className}"
	>
		{gameTitle(shot)}
	</a>
{/snippet}

{#snippet deleteControl(shot: GameScreenshot, className: string)}
	<!-- Always visible, never hover-only: a hover reveal has no equivalent on
	     touch, and this is the owner's only route to making a game private
	     again. The caller places it — a corner of the picture in the grid, the
	     panel's own control row in the stack — while the icon, the labels and
	     the handler are the same either way. -->
	<button
		type="button"
		onclick={() => remove(shot)}
		class="cursor-pointer text-red-400 transition-colors hover:text-red-300 {className}"
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
{/snippet}

{#snippet starControl(shot: GameScreenshot, className: string)}
	<!-- Opposite the owner's delete wherever both are offered, so an admin
	     looking at their own gallery has the two of them without either
	     covering the other. Always visible rather than revealed on hover — the
	     delete's reasoning, which applies harder here: a control whose point is
	     to be where a screenshot is come across cannot be one that touch never
	     offers. Published rows only: `star` answers 409 on a hidden one, and
	     the only in_review shots an admin is ever sent are their own.
	     Filled = on the home strip. -->
	<button
		type="button"
		onclick={() => toggleStar(shot)}
		disabled={starring.has(shot.screenshot_id)}
		aria-pressed={shot.featured}
		aria-label={shot.featured
			? "Remove from the home strip"
			: "Star for the home strip"}
		title={shot.featured
			? "Remove from the home strip"
			: "Star for the home strip"}
		class="cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50 {shot.featured
			? 'text-orange'
			: 'text-tan'} {className}"
	>
		<StarMark class="block h-3.5 w-3.5" filled={shot.featured} />
	</button>
{/snippet}

{#if layout === "panels"}
	<!-- Columns of at most 40rem — a bit more than twice the picture's 18rem, so
	     the text column is about as wide as the picture beside it and a lone
	     panel can't stretch to the page's full width. The cap is the track's own
	     maximum rather than a max-width on the panel, which is what keeps the
	     cells flush: a capped panel inside a 1fr track would leave slack inside
	     every cell instead of once at the end of the row.
	     One, two, then three across. `lg` is where two fit (a 478px cell still
	     seats the 288px picture with its text beside it) and `2xl` is where
	     three do; one step earlier each would be a cell too narrow for the row
	     the panel is. Three is the ceiling in practice — the page itself is
	     capped at `screen-2xl`, which is narrower than four of these tracks. -->
	<div
		class="grid grid-cols-[minmax(0,40rem)] gap-3 lg:grid-cols-[repeat(2,minmax(0,40rem))] 2xl:grid-cols-[repeat(3,minmax(0,40rem))]"
	>
		{#each screenshots as shot (shot.screenshot_id)}
			{@const uploaded = formatLongDate(shot.created_at)}
			<!-- `group` is what dims the picture when the pointer is anywhere on
			     the panel, since anywhere on the panel is what opens it. -->
			<figure
				class="group relative flex flex-col gap-3 rounded-lg bg-surface p-3 sm:flex-row"
			>
				<!-- Stretched over the whole figure: the picture, the caption and the
				     date are all of one screenshot, so the card is one control
				     rather than a picture you may press beside text you may not.
				     The stretched-overlay idiom RecentSaveCard and VideoCard use,
				     with the controls below raised above it (higher z-index) so each
				     still wins its own clicks. A button rather than a link, because
				     what it opens is the lightbox and not a route. -->
				<button
					type="button"
					onclick={() => open(shot)}
					class="absolute inset-0 z-10 cursor-pointer rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange"
					aria-label={viewLabel(shot)}
				></button>
				<!-- 18rem, which is both a ceiling and the row's whole width: the
				     picture is the one element here whose size is settled elsewhere
				     (640 px covering 2x, see the note above), so it keeps that box
				     and the text takes what is left. Below `sm` the two stack, where
				     the cap is what keeps the picture inside a 320 px viewport
				     without letting it grow to a 639 px one and go soft. -->
				<div
					class="w-full max-w-[18rem] overflow-hidden rounded bg-surface-deep transition group-hover:opacity-90 sm:flex-none"
				>
					{@render thumbnail(shot)}
				</div>
				<!-- figcaption is the figure's last child, where the spec puts it, so
				     the controls sit inside it rather than in a wrapper that would
				     take the caption out of the figure altogether. -->
				<figcaption class="flex min-w-0 flex-1 flex-col gap-1.5">
					{#if shot.caption}
						<!-- Wrapped, not truncated: the caption is what the uploader had
						     to say about the picture, and this layout exists to have room
						     for it. 200 characters (SCREENSHOT_CAPTION_MAX) at this width
						     stays inside the picture's own height, so a long one doesn't
						     grow the panel. -->
						<p class="text-sm text-tan">{shot.caption}</p>
					{/if}
					{#if showGame}
						{@render gameLink(shot, "relative z-20 text-sm")}
					{/if}
					{#if uploaded}
						<!-- Named, because a bare date beside a picture says nothing about
						     which date it is. Longhand, as the terms panel's signature
						     reads it, rather than the short form a dense row needs. -->
						<p class="text-xs text-muted">Uploaded {uploaded}</p>
					{/if}
					{#if shot.status === "in_review"}
						<!-- Above the panel's overlay, because the badge carries the
						     tooltip that says what `in_review` means — under it, the
						     overlay would take the hover and the explanation would
						     never appear. It costs the badge's own few pixels as a
						     press target. -->
						{@render inReviewBadge(
							"relative z-20 w-fit rounded bg-orange/15 px-2 py-0.5 text-[10px] uppercase tracking-wide",
						)}
					{/if}
					{#if canDelete || (canStar && shot.status === "published")}
						<!-- The panel's own control row, off the picture and at the foot of
						     the column: in a layout with a text column, a control belongs
						     with the text rather than over the image it acts on. `mt-auto`
						     holds it at the bottom whatever the caption's length. -->
						<div
							class="relative z-20 mt-auto flex w-fit items-center gap-2 pt-1"
						>
							{#if canStar && shot.status === "published"}
								{@render starControl(
									shot,
									"rounded bg-surface-raised p-1.5 hover:bg-surface-raised-hover",
								)}
							{/if}
							{#if canDelete}
								{@render deleteControl(
									shot,
									"rounded bg-surface-raised p-1.5 hover:bg-surface-raised-hover",
								)}
							{/if}
						</div>
					{/if}
				</figcaption>
			</figure>
		{/each}
	</div>
{:else}
	<div
		class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
	>
		{#each screenshots as shot (shot.screenshot_id)}
			<figure class="min-w-0">
				<div class="relative">
					{@render picture(shot, "w-full")}
					{#if shot.status === "in_review"}
						{@render inReviewBadge(
							"absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-xs",
						)}
					{/if}
					{#if canDelete}
						{@render deleteControl(
							shot,
							"absolute right-1 top-1 rounded bg-black/60 p-1 hover:bg-black/80",
						)}
					{/if}
					{#if canStar && shot.status === "published"}
						{@render starControl(
							shot,
							"absolute left-1 top-1 rounded bg-black/60 p-1 hover:bg-black/80",
						)}
					{/if}
				</div>
				{#if shot.caption || showGame}
					<figcaption class="mt-1 min-w-0 text-xs">
						{#if shot.caption}
							<p class="truncate text-tan" title={shot.caption}>
								{shot.caption}
							</p>
						{/if}
						{#if showGame}
							{@render gameLink(shot, "")}
						{/if}
					</figcaption>
				{/if}
			</figure>
		{/each}
	</div>
{/if}

<FullscreenDialog bind:open={lightboxOpen} onclose={() => (lightbox = null)}>
	{#if lightbox}
		<!-- A panel with the close button in its header, the shape a chart's
		     fullscreen view and the map view's tab lightbox already have. Escape
		     and a click on the backdrop close this dialog as they close those,
		     but neither is on screen: a picture alone over the backdrop had no
		     edge and nothing that said how to get back out of it. -->
		<div class="flex min-h-0 flex-1 flex-col gap-3 rounded-lg bg-surface p-3">
			<header class="flex flex-none items-center justify-between gap-3">
				<!-- The game the picture is of. From the prop on a game's own view,
				     where every row is that game; from the row itself on the profile
				     tab, which spans games. -->
				<h2 class="truncate text-base font-bold text-tan">
					{gameName ?? gameTitle(lightbox)}
				</h2>
				<button
					type="button"
					onclick={() => (lightboxOpen = false)}
					class="cursor-pointer rounded bg-black/20 p-1.5 transition-colors hover:bg-black/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange"
					aria-label="Close screenshot"
					title="Close (Esc)"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="block h-4 w-4 text-white"
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
			</header>
			<!-- The stored object, full size — the only surface that serves it.
			     width/height are the stored variant's own, so the browser reserves
			     the right box while it loads. Centred in the room the header and
			     the caption leave, and never upscaled past the stored variant's
			     own size. -->
			<div class="flex min-h-0 flex-1 items-center justify-center">
				<img
					src={lightbox.url}
					alt={lightbox.caption ?? "Game screenshot"}
					width={lightbox.width}
					height={lightbox.height}
					class="max-h-full max-w-full rounded object-contain"
				/>
			</div>
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
						<!-- The recessed step inside the panel, as a PanelInset is: on
						     the backdrop this was a `surface` card, which is the panel's
						     own surface now that there is a panel around it. -->
						<div
							class="mx-auto max-w-xs rounded-lg bg-surface-deep p-3 text-left"
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
