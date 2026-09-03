<script lang="ts">
	import { resolve } from "$app/paths";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import ChallengeRowCard from "$lib/challenges/ChallengeRowCard.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const open = $derived(data.challenges.filter((c) => c.status === "open"));
	const closed = $derived(data.challenges.filter((c) => c.status === "closed"));
	const groups = $derived(
		[
			{ label: "Open", items: open },
			{ label: "Closed", items: closed },
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
					<h1 class="text-2xl font-bold text-gray-200">Challenge Maps</h1>
					{#if data.user}
						<a
							href={resolve("/challenges/new")}
							class="rounded bg-surface-raised px-3 py-1.5 text-sm font-bold text-tan transition-colors hover:bg-surface-raised-hover"
						>
							New challenge
						</a>
					{/if}
				</div>
				<p class="mb-4 max-w-2xl text-sm text-gray-400">
					Download a turn-1 map, play it, and upload your save: the run is
					scored on the turn every objective is met. Lowest turn wins.
				</p>

				{#if data.challenges.length === 0}
					<p class="text-sm text-tan opacity-70">No challenges yet.</p>
				{:else}
					{#each groups as group (group.label)}
						<section class="mb-6">
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
								{#each group.items as challenge (challenge.challenge_id)}
									<ChallengeRowCard {challenge} />
								{/each}
							</div>
						</section>
					{/each}
				{/if}
			</div>
		</div>
	</main>
</div>
