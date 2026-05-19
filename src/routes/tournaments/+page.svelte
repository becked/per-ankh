<script lang="ts">
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import TournamentRowCard from "$lib/tournament/TournamentRowCard.svelte";
	import TournamentCreateModal from "$lib/tournament/TournamentCreateModal.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let showCreateModal = $state(false);

	// `myTournaments` is loaded by the root layout (`src/routes/+layout.ts`)
	// and propagated into every page's data. Used here to mark each card with
	// "✓ You're in" instead of the generic status badge.
	const enrolledIds = $derived(
		new Set((data.myTournaments ?? []).map((t) => t.tournament_id)),
	);

	// Three groups so the most actionable tournaments are at the top:
	//   1. Open for signups (status='setup' + signups_open) — the player
	//      can join right now.
	//   2. Active (everything else that's not complete).
	//   3. Past (complete).
	const open = $derived(
		data.tournaments.filter((t) => t.status === "setup" && t.signups_open),
	);
	const active = $derived(
		data.tournaments.filter(
			(t) =>
				t.status !== "complete" && !(t.status === "setup" && t.signups_open),
		),
	);
	const completed = $derived(
		data.tournaments.filter((t) => t.status === "complete"),
	);
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-4xl">
				<div class="mb-4 flex items-center justify-between gap-3">
					<h1 class="text-2xl font-bold text-tan">Tournaments</h1>
					{#if data.user}
						<button
							type="button"
							class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs text-tan"
							onclick={() => (showCreateModal = true)}
						>
							+ New tournament
						</button>
					{/if}
				</div>

				{#if data.tournaments.length === 0}
					<p class="text-sm text-tan opacity-70">
						No tournaments yet. Check back when one starts.
					</p>
				{:else}
					{#if open.length > 0}
						<section class="mb-6">
							<h2
								class="mb-2 text-xs uppercase tracking-wide text-tan opacity-60"
							>
								Open for signups
							</h2>
							<div class="space-y-3">
								{#each open as t (t.tournament_id)}
									<TournamentRowCard
										tournament={t}
										enrolled={enrolledIds.has(t.tournament_id)}
									/>
								{/each}
							</div>
						</section>
					{/if}
					{#if active.length > 0}
						<section class="mb-6">
							<h2
								class="mb-2 text-xs uppercase tracking-wide text-tan opacity-60"
							>
								Active
							</h2>
							<div class="space-y-3">
								{#each active as t (t.tournament_id)}
									<TournamentRowCard
										tournament={t}
										enrolled={enrolledIds.has(t.tournament_id)}
									/>
								{/each}
							</div>
						</section>
					{/if}
					{#if completed.length > 0}
						<section>
							<h2
								class="mb-2 text-xs uppercase tracking-wide text-tan opacity-60"
							>
								Past
							</h2>
							<div class="space-y-3">
								{#each completed as t (t.tournament_id)}
									<TournamentRowCard tournament={t} />
								{/each}
							</div>
						</section>
					{/if}
				{/if}
			</div>
		</div>
	</main>
</div>

{#if showCreateModal}
	<TournamentCreateModal onClose={() => (showCreateModal = false)} />
{/if}
