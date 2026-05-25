<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import BulkReparseModal from "$lib/BulkReparseModal.svelte";
	import BulkReindexModal from "$lib/BulkReindexModal.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let reparseOpen = $state(false);
	let reindexOpen = $state(false);

	const ownerCount = $derived(
		new Set(data.outOfDateGames.map((g) => g.user_id)).size,
	);

	async function onReparseClose(didReparse: boolean) {
		reparseOpen = false;
		if (didReparse) await invalidateAll();
	}

	async function onReindexClose(didReindex: boolean) {
		reindexOpen = false;
		if (didReindex) await invalidateAll();
	}
</script>

<svelte:head>
	<title>Admin — Per-Ankh</title>
</svelte:head>

<main class="cloud-scroll flex-1 overflow-y-auto px-4 py-8" use:autohideScroll>
	<div class="mx-auto max-w-xl space-y-4">
		<div class="rounded-lg p-4" style="background-color: #2a2622;">
			<h3 class="mb-3 text-base font-bold text-tan">Admin — Reparse</h3>
			<div class="rounded-lg p-3" style="background-color: #35302B;">
				<p class="mb-3 text-xs text-tan">
					Reparse every game whose stored parser version is older than the
					current build. Downloads, parses, and re-uploads each game in this
					browser tab. Audited as <code class="text-orange">admin_reimport</code
					>.
				</p>
				<div class="mb-3 text-sm text-tan">
					{#if data.outOfDateGames.length === 0}
						All games are on the current parser version.
					{:else}
						{data.outOfDateGames.length}
						{data.outOfDateGames.length === 1 ? "game" : "games"} across {ownerCount}
						{ownerCount === 1 ? "user" : "users"}.
					{/if}
				</div>
				<button
					type="button"
					onclick={() => (reparseOpen = true)}
					disabled={data.outOfDateGames.length === 0}
					class="hover:bg-orange/80 rounded bg-orange px-3 py-1 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-orange"
				>
					{data.outOfDateGames.length === 0
						? "Nothing to reparse"
						: `Reparse all ${data.outOfDateGames.length}`}
				</button>
			</div>
		</div>

		<div class="rounded-lg p-4" style="background-color: #2a2622;">
			<h3 class="mb-3 text-base font-bold text-tan">Admin — Reindex</h3>
			<div class="rounded-lg p-3" style="background-color: #35302B;">
				<p class="mb-3 text-xs text-tan">
					Rebuild every game's derived D1 tables (summaries, per-turn series,
					tech &amp; law events) from its stored blob. No re-parse — reads each
					game's existing cloud blob and re-runs the database pivot in the
					Worker. Use this to backfill columns added after upload (e.g. per-turn
					victory points). Audited as <code class="text-orange"
						>admin_reindex</code
					>.
				</p>
				<div class="mb-3 text-sm text-tan">
					{#if data.allGames.length === 0}
						No games to reindex.
					{:else}
						{data.allGames.length}
						{data.allGames.length === 1 ? "game" : "games"}.
					{/if}
				</div>
				<button
					type="button"
					onclick={() => (reindexOpen = true)}
					disabled={data.allGames.length === 0}
					class="hover:bg-orange/80 rounded bg-orange px-3 py-1 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-orange"
				>
					{data.allGames.length === 0
						? "Nothing to reindex"
						: `Reindex all ${data.allGames.length}`}
				</button>
			</div>
		</div>
	</div>
</main>

{#if reparseOpen}
	<BulkReparseModal
		games={data.outOfDateGames}
		onClose={onReparseClose}
		adminMode={true}
	/>
{/if}

{#if reindexOpen}
	<BulkReindexModal games={data.allGames} onClose={onReindexClose} />
{/if}
