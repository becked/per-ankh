<script lang="ts">
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import TournamentCard from "$lib/tournament/TournamentCard.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// Group by status so active tournaments surface above completed ones.
	const active = $derived(
		data.tournaments.filter((t) => t.status !== "complete"),
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
				<h1 class="mb-4 text-2xl font-bold text-tan">Tournaments</h1>

				{#if data.tournaments.length === 0}
					<p class="text-sm text-tan opacity-70">
						No tournaments yet. Check back when one starts.
					</p>
				{:else}
					{#if active.length > 0}
						<section class="mb-6">
							<h2
								class="mb-2 text-xs uppercase tracking-wide text-tan opacity-60"
							>
								Active
							</h2>
							<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
								{#each active as t (t.tournament_id)}
									<TournamentCard tournament={t} />
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
							<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
								{#each completed as t (t.tournament_id)}
									<TournamentCard tournament={t} />
								{/each}
							</div>
						</section>
					{/if}
				{/if}
			</div>
		</div>
	</main>
</div>
