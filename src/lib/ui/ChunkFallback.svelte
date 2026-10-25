<script lang="ts">
	// What a host renders in place of a chunk that hasn't arrived: the wait,
	// and the dead end a failed fetch lands on. Two surfaces render it — a
	// game's tabs (game-detail/GameTab.svelte) and a chart (Chart.svelte) —
	// and each owns the box it sits in, because a tab pane and a chart's
	// reserved height are different shapes.
	//
	// A reload is the only offer, not a retry: see $lib/deferred.svelte for
	// why a retry against the same manifest fails the same way.
	let {
		failed,
		message,
	}: {
		failed: boolean;
		/** What didn't load, as a sentence: "This chart didn't load." */
		message: string;
	} = $props();
</script>

{#if failed}
	<div class="flex flex-col items-center gap-3">
		<p class="text-sm text-gray-400">{message}</p>
		<button
			type="button"
			onclick={() => location.reload()}
			class="rounded border border-brown px-3 py-1.5 text-xs font-semibold text-tan transition-colors hover:bg-brown"
		>
			Reload the page
		</button>
	</div>
{:else}
	<p class="text-sm text-gray-400">Loading…</p>
{/if}
