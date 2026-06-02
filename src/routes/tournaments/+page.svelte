<script lang="ts">
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import TournamentRowCard from "$lib/tournament/TournamentRowCard.svelte";
	import CreateTournamentPopover from "$lib/tournament/CreateTournamentPopover.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// `myTournaments` is loaded by the root layout (`src/routes/+layout.ts`)
	// and propagated into every page's data. Used here to mark each card with
	// "✓ You're in" instead of the generic status badge.
	const enrolledIds = $derived(
		new Set((data.myTournaments ?? []).map((t) => t.tournament_id)),
	);

	// Four groups, most-actionable first:
	//   1. Open for signups (setup + signups_open) — the player can join now.
	//   2. Active (swiss / championship) — in progress.
	//   3. Setup (setup, signups closed) — configured but not yet started.
	//   4. Past (complete).
	const open = $derived(
		data.tournaments.filter((t) => t.status === "setup" && t.signups_open),
	);
	const setup = $derived(
		data.tournaments.filter((t) => t.status === "setup" && !t.signups_open),
	);
	const active = $derived(
		data.tournaments.filter(
			(t) => t.status !== "setup" && t.status !== "complete",
		),
	);
	const completed = $derived(
		data.tournaments.filter((t) => t.status === "complete"),
	);

	// Render order + labels. `enrollable` gates the "✓ You're in" badge — we
	// keep it off Past so finished tournaments read "Complete", not enrolled.
	const groups = $derived(
		[
			{ label: "Open for signups", items: open, enrollable: true },
			{ label: "Active", items: active, enrollable: true },
			{ label: "Setup", items: setup, enrollable: true },
			{ label: "Past", items: completed, enrollable: false },
		].filter((g) => g.items.length > 0),
	);
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-screen-2xl">
				<div class="mb-4 flex items-center justify-between gap-3">
					<h1 class="text-2xl font-bold text-gray-200">Tournaments</h1>
					{#if data.user?.is_beta}
						<CreateTournamentPopover />
					{/if}
				</div>

				{#if data.tournaments.length === 0}
					<p class="text-sm text-tan opacity-70">
						No tournaments yet. Check back when one starts.
					</p>
				{:else}
					{#each groups as group (group.label)}
						<section class="mb-6">
							<!-- Status separator, matching the month dividers in the user
							     games list: centered label flanked by hairlines. -->
							<div class="my-2 flex items-center gap-2 px-1">
								<div class="h-px flex-1 bg-tan opacity-30"></div>
								<span
									class="text-[10px] uppercase tracking-wide text-tan opacity-60"
								>
									{group.label}
								</span>
								<div class="h-px flex-1 bg-tan opacity-30"></div>
							</div>
							<div class="space-y-3">
								{#each group.items as t (t.tournament_id)}
									<TournamentRowCard
										tournament={t}
										enrolled={group.enrollable &&
											enrolledIds.has(t.tournament_id)}
									/>
								{/each}
							</div>
						</section>
					{/each}
				{/if}
			</div>
		</div>
	</main>
</div>
