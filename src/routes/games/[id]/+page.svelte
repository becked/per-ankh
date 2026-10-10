<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import type { PageData } from "./$types";
	import { GameDetailView } from "$lib/game-detail";
	import GameHeader from "$lib/game-detail/GameHeader.svelte";
	import { autohideScroll } from "$lib/actions/autohideScroll";

	let { data }: { data: PageData } = $props();
	const game = $derived(data.game);
	const gameId = $derived(page.params.id ?? "");

	// Links to the old Map tab (/games/[id]#map) land on the map view, replacing
	// the entry rather than adding one. The view isn't mounted while the hash is
	// #map: its own hash effect would otherwise select a "map" tab that no
	// longer exists (an empty pane), and goto is async, so the URL still reads
	// #map when that effect runs. Not mounting it wins without depending on
	// effect order. page.url.hash reads "" during SSR.
	const isMapHash = $derived(page.url.hash === "#map");
	$effect(() => {
		if (isMapHash) {
			goto(resolve("/games/[id]/map", { id: gameId }), { replaceState: true });
		}
	});
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-screen-2xl">
				<GameHeader
					{game}
					isOwner={data.isOwner}
					collections={data.collections}
					tournamentLink={data.tournamentLink}
					challengeLink={data.challengeLink}
				/>
				{#if !isMapHash}
					<GameDetailView {game} />
				{/if}
			</div>
		</div>
	</main>
</div>
