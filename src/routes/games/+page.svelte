<script lang="ts">
	import type { PageData } from "./$types";
	import { formatEnum, formatDate } from "$lib/utils/formatting";

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Games — Per-Ankh</title>
</svelte:head>

<main class="min-h-screen bg-blue-gray px-4 py-8">
	<div class="mx-auto max-w-4xl">
		<div class="mb-6 flex items-center justify-between">
			<h1 class="font-serif text-2xl text-tan">Your games</h1>
			<a
				href="/upload"
				class="rounded bg-orange px-4 py-2 text-sm font-bold text-white hover:bg-orange/80"
			>
				Upload
			</a>
		</div>

		{#if data.games.length === 0}
			<div class="rounded border-2 border-brown bg-[#2a2622] p-8 text-center">
				<p class="mb-4 text-tan">No games yet.</p>
				<a href="/upload" class="text-sm font-bold text-orange underline">
					Upload your first game
				</a>
			</div>
		{:else}
			<ul class="space-y-2">
				{#each data.games as game (game.game_id)}
					<li>
						<a
							href={`/games/${game.game_id}`}
							class="flex items-center gap-4 rounded border border-brown bg-[#2a2622] p-3 hover:border-orange"
						>
							<div class="flex-1 min-w-0">
								<div class="truncate font-bold text-tan">
									{game.game_name ?? "Unnamed game"}
								</div>
								<div class="text-xs text-brown">
									{game.user_nation ? formatEnum(game.user_nation, "NATION_") : "—"}
									· Turn {game.total_turns}
									{#if game.save_date}
										· {formatDate(game.save_date)}
									{/if}
								</div>
							</div>
							<div class="text-right text-xs">
								{#if game.user_nation === null}
									<span class="rounded bg-brown px-2 py-1 font-bold text-tan">
										OBSERVED
									</span>
								{:else if game.user_won === true}
									<span class="rounded bg-green-700 px-2 py-1 font-bold text-white">
										WON
									</span>
								{:else if game.user_won === false}
									<span class="rounded bg-red-700 px-2 py-1 font-bold text-white">
										LOST
									</span>
								{:else}
									<span class="text-brown">In progress</span>
								{/if}
							</div>
						</a>
					</li>
				{/each}
			</ul>
			{#if data.total > data.games.length}
				<p class="mt-4 text-center text-xs text-brown">
					Showing {data.games.length} of {data.total}
				</p>
			{/if}
		{/if}
	</div>
</main>
