<script lang="ts">
	// The Screenshots tab on /admin (issue #289, step 6): moderation layer 2's
	// human end — the queue that needs a decision, and the starred set that is
	// on the home page.
	//
	// A card per screenshot rather than the row-per-item table the Featured
	// tab uses, for one reason: the thing being judged is an image, so the
	// image has to be on screen at a size you can actually read. The panel
	// chrome around it is the Featured tab's, so the four tabs still look like
	// four tabs.
	//
	// Both lists come from the page load, in the order the Worker put them —
	// the queue oldest first, because a queue is served in the order it
	// arrived, and the starred set newest first. An action re-runs the load
	// rather than patching a row: a takedown resolves reports and clears a
	// star too, so the row that comes back is a different row and the server
	// is where that is decided.
	import { invalidateAll } from "$app/navigation";
	import {
		cloudApi,
		type ModerationScreenshot,
		type ScreenshotModerationAction,
		type ScreenshotModerationLists,
	} from "$lib/api-cloud";
	import ProfileLink from "$lib/ProfileLink.svelte";
	import { screenshotReportReasonLabel } from "$lib/screenshots/report-reasons";
	import { confirmDialog } from "$lib/ui/confirm";
	import { toast } from "$lib/ui/toast";
	import { formatDate, formatGameTitle } from "$lib/utils/formatting";

	let { screenshots }: { screenshots: ScreenshotModerationLists } = $props();

	// Which screenshot is mid-write, read as presence only: EVERY control on
	// the tab disables while one decision is in flight. That is the Featured
	// tab's shape (`removing`, FeaturedVideosTable) and it is what an action
	// here wants on top of it — each one ends in invalidateAll(), so both
	// lists are about to be replaced wholesale and a second decision pressed
	// meanwhile would be aimed at a row that is on its way out. The id is what
	// is held rather than a flag, again like the sibling, so a later control
	// that wants to mark its own card has it.
	//
	// The gallery's star is the other shape — a keyed set, so only the pressed
	// star disables (ScreenshotGallery). Curating a strip is several presses in
	// a row, and nothing there reloads the page.
	let busy = $state<string | null>(null);

	function gameTitle(shot: ModerationScreenshot): string {
		// match_id: 0 is only consulted when name, nation and turns are all
		// missing — the shape the gallery and RecentSaveCard both use.
		return formatGameTitle({
			display_name: shot.game.display_name,
			game_name: shot.game.game_name,
			save_owner_nation: shot.game.user_nation,
			total_turns: shot.game.total_turns,
			match_id: 0,
		});
	}

	// The classifier's own numbers, as the queue reads them: the questions it
	// flagged first, because that is why the row is here, then the rest. Three
	// decimals because the bands are set to two and a margin of 0.05-0.074 is
	// the whole difference between a queued row and a published one.
	// The four noul questions, as keys of the payload itself rather than as
	// four strings retyped here: a typo is then a type error, and the
	// probability comes back as a number with no cast.
	type ClefQuestion = Exclude<
		keyof ModerationScreenshot["clef"],
		"game_screenshot_confidence" | "tripped"
	>;

	const QUESTIONS: { id: ClefQuestion; label: string }[] = [
		{ id: "is_old_world", label: "Old World" },
		{ id: "contains_nsfw", label: "NSFW" },
		{ id: "contains_gore", label: "Gore" },
		{ id: "is_a_photograph", label: "Photo" },
	];

	function clefReadout(shot: ModerationScreenshot): string {
		const tripped = new Set(shot.clef.tripped);
		return [...QUESTIONS]
			.sort((a, b) => Number(tripped.has(b.id)) - Number(tripped.has(a.id)))
			.map(
				(q) =>
					`${q.label} ${shot.clef[q.id].toFixed(3)}${
						tripped.has(q.id) ? " ⚑" : ""
					}`,
			)
			.join(" · ");
	}

	// What the failure toast calls each action. The wire vocabulary is not
	// English — "Couldn't takedown that screenshot" is not a sentence — and
	// `resolve_reports` is a phrase rather than a verb.
	const ACTION_VERB: Record<ScreenshotModerationAction, string> = {
		takedown: "take down",
		approve: "approve",
		star: "star",
		unstar: "unstar",
		resolve_reports: "dismiss the reports on",
	};

	// What each action says before it runs. Only `takedown` confirms: it
	// deletes the stored object and purges both its URLs, so it is the one
	// decision here that cannot be taken back — the others move a column.
	async function act(
		shot: ModerationScreenshot,
		action: ScreenshotModerationAction,
	): Promise<void> {
		if (busy !== null) return;
		if (action === "takedown") {
			const ok = await confirmDialog({
				title: "Take this screenshot down?",
				message:
					"This deletes the image and clears it from the cache. It can't be undone — the screenshot can't be put back, only re-uploaded by its owner.",
				confirmLabel: "Take down",
				destructive: true,
			});
			if (!ok) return;
		}
		busy = shot.screenshot_id;
		try {
			await cloudApi.adminModerateScreenshot(shot.screenshot_id, action);
			await invalidateAll();
		} catch (err) {
			toast.error(
				`Couldn't ${ACTION_VERB[action]} that screenshot: ${
					err instanceof Error ? err.message : err
				}`,
			);
		} finally {
			busy = null;
		}
	}

	const actionClass =
		"cursor-pointer rounded bg-orange px-2 py-0.5 text-xs font-bold text-white hover:bg-orange/80 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-orange";
	const quietActionClass =
		"cursor-pointer rounded border border-black bg-surface px-2 py-0.5 text-xs font-bold text-tan hover:bg-tan-hover disabled:cursor-not-allowed disabled:opacity-50";
</script>

{#snippet card(shot: ModerationScreenshot)}
	<div class="flex gap-3 border-b border-black/50 py-3 last:border-0">
		<!-- The thumbnail, at the one transformation size the feature mints, and
		     a link to the stored object for the full 1600 px variant. An
		     <a> rather than a lightbox: this surface is already a decision
		     form, and the full image is what the decision is about. -->
		<!-- The public image host, not an app route, so resolve() doesn't
		     apply; rel guards tabnabbing + referrer leakage. -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a
			href={shot.url}
			target="_blank"
			rel="noopener noreferrer"
			class="block w-32 flex-none overflow-hidden rounded bg-surface-deep"
			title="Open the full image"
		>
			<img
				src={shot.thumb_url}
				alt={shot.caption ?? "Reported screenshot"}
				width="640"
				height="400"
				loading="lazy"
				class="aspect-[8/5] w-full object-cover"
			/>
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->

		<div class="min-w-0 flex-1 text-xs text-tan">
			<div class="flex flex-wrap items-center gap-x-2">
				<ProfileLink
					userId={shot.uploader.user_id}
					slug={shot.uploader.slug}
					class="font-bold hover:underline"
				>
					{shot.uploader.display_name ?? "Unknown"}
				</ProfileLink>
				<span class="text-gray-400">{formatDate(shot.created_at)}</span>
				{#if shot.status === "in_review"}
					<span class="font-bold text-orange">Queued by the classifier</span>
				{/if}
				{#if shot.featured_at}
					<span class="font-bold text-orange">★ On the home strip</span>
				{/if}
			</div>

			<div class="truncate text-gray-400" title={gameTitle(shot)}>
				{gameTitle(shot)}
			</div>
			{#if shot.caption}
				<p class="truncate" title={shot.caption}>“{shot.caption}”</p>
			{/if}

			<p class="mt-1 text-gray-400">{clefReadout(shot)}</p>

			{#if shot.reports.length > 0}
				<ul class="mt-1 space-y-0.5">
					{#each shot.reports as report (report.reporter.user_id)}
						<li>
							<span class="font-bold"
								>{screenshotReportReasonLabel(report.reason)}</span
							>
							<span class="text-gray-400">
								— <ProfileLink
									userId={report.reporter.user_id}
									slug={report.reporter.slug}
									class="hover:underline"
								>
									{report.reporter.display_name ?? "Unknown"}
								</ProfileLink>, {formatDate(report.created_at)}
							</span>
						</li>
					{/each}
				</ul>
			{/if}

			<div class="mt-2 flex flex-wrap items-center gap-2">
				{#if shot.status === "in_review"}
					<!-- The only state `approve` can act on: the object is still in
					     R2. A takedown deletes it, which is why a taken-down row
					     offers nothing. -->
					<button
						type="button"
						onclick={() => act(shot, "approve")}
						disabled={busy !== null}
						class={actionClass}
					>
						Approve
					</button>
				{/if}
				<!-- On a queued row this is the reject half of the decision; on a
				     published one it takes down something already visible. Either
				     way it is the same endpoint and the same three steps. -->
				<button
					type="button"
					onclick={() => act(shot, "takedown")}
					disabled={busy !== null}
					class={actionClass}
				>
					Take down
				</button>
				{#if shot.reports.length > 0}
					<button
						type="button"
						onclick={() => act(shot, "resolve_reports")}
						disabled={busy !== null}
						class={quietActionClass}
					>
						Dismiss {shot.reports.length === 1
							? "report"
							: `${shot.reports.length} reports`}
					</button>
				{/if}
				{#if shot.status === "published"}
					<button
						type="button"
						onclick={() => act(shot, shot.featured_at ? "unstar" : "star")}
						disabled={busy !== null}
						class={quietActionClass}
					>
						{shot.featured_at ? "Unstar" : "Star for home"}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/snippet}

<div class="space-y-4">
	<div
		class="rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<h3 class="mb-3 text-base font-bold text-tan">Admin — Screenshot queue</h3>
		<div
			class="rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<p class="mb-3 text-xs text-tan">
				Screenshots the classifier wasn't sure about, which no surface renders
				until they're approved here, and screenshots a viewer has reported. A
				takedown deletes the image and purges it from the edge — it can't be
				undone, and it resolves the reports that prompted it.
			</p>
			{#if screenshots.queue.length === 0}
				<div class="py-6 text-center text-sm text-gray-400">
					Nothing waiting on a decision.
				</div>
			{:else}
				{#each screenshots.queue as shot (shot.screenshot_id)}
					{@render card(shot)}
				{/each}
			{/if}
		</div>
	</div>

	<div
		class="rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<h3 class="mb-3 text-base font-bold text-tan">Admin — Home strip</h3>
		<div
			class="rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<p class="mb-3 text-xs text-tan">
				Starred screenshots, newest first. Only these reach the home page.
			</p>
			{#if screenshots.featured.length === 0}
				<div class="py-6 text-center text-sm text-gray-400">
					No starred screenshots.
				</div>
			{:else}
				{#each screenshots.featured as shot (shot.screenshot_id)}
					{@render card(shot)}
				{/each}
			{/if}
		</div>
	</div>
</div>
