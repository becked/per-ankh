<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import BulkReparseModal from "$lib/BulkReparseModal.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let reparseOpen = $state(false);

	const ownerCount = $derived(
		new Set(data.games.map((g) => g.user_id)).size,
	);

	async function onReparseClose(didReparse: boolean) {
		reparseOpen = false;
		if (didReparse) await invalidateAll();
	}
</script>

<svelte:head>
	<title>Admin — Reparse — Per-Ankh</title>
</svelte:head>

<main class="cloud-scroll flex-1 overflow-y-auto px-4 py-8" use:autohideScroll>
	<div class="mx-auto max-w-xl">
		<div class="rounded-lg p-4" style="background-color: #2a2622;">
			<h3 class="mb-3 text-base font-bold text-tan">Admin — Reparse</h3>
			<div class="rounded-lg p-3" style="background-color: #35302B;">
				<p class="mb-3 text-xs text-tan">
					Reparse every game whose stored parser version is older than the
					current build. Downloads, parses, and re-uploads each game in this
					browser tab. Audited as <code class="text-orange">admin_reimport</code>.
				</p>
				<div class="mb-3 text-sm text-tan">
					{#if data.games.length === 0}
						All games are on the current parser version.
					{:else}
						{data.games.length}
						{data.games.length === 1 ? "game" : "games"} across {ownerCount}
						{ownerCount === 1 ? "user" : "users"}.
					{/if}
				</div>
				<button
					type="button"
					onclick={() => (reparseOpen = true)}
					disabled={data.games.length === 0}
					class="rounded bg-orange px-3 py-1 text-xs font-bold text-white hover:bg-orange/80 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-orange"
				>
					{data.games.length === 0
						? "Nothing to reparse"
						: `Reparse all ${data.games.length}`}
				</button>
			</div>
		</div>
	</div>
</main>

{#if reparseOpen}
	<BulkReparseModal
		games={data.games}
		onClose={onReparseClose}
		adminMode={true}
	/>
{/if}
