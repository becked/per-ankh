<script lang="ts">
	import type { TournamentDetail } from "$lib/api-cloud";
	import { divisionName } from "$lib/tournament/bracket-label";
	import Popover from "$lib/ui/Popover.svelte";

	interface Props {
		tournament: TournamentDetail;
		busy?: boolean;
		// Page-level withdraw handler (cloudApi call + toast + invalidate). The
		// explicit Withdraw button is the deliberate confirmation — no extra
		// confirm dialog needed.
		onWithdraw: () => void;
	}

	let { tournament, busy = false, onWithdraw }: Props = $props();

	let open = $state(false);

	const viewerSlot = $derived(tournament.viewer_slot);

	function withdraw() {
		open = false;
		onWithdraw();
	}
</script>

<Popover
	bind:open
	ariaLabel="You're signed up"
	contentClass="w-[min(92vw,24rem)]"
>
	{#snippet trigger({ props })}
		<button
			{...props}
			type="button"
			class="whitespace-nowrap rounded border border-tan px-2.5 py-1 text-xs text-tan opacity-80 transition-opacity hover:opacity-100"
			title="You're signed up"
		>
			Signed up
		</button>
	{/snippet}

	{#if viewerSlot}
		<header class="mb-3 flex items-start justify-between gap-3">
			<h2 class="text-lg font-bold text-tan">You're signed up</h2>
			<button
				type="button"
				class="text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100"
				onclick={() => (open = false)}
				aria-label="Close"
			>
				✕
			</button>
		</header>
		<p class="text-xs text-tan">
			Division:
			<span class="font-bold"
				>{divisionName(tournament, viewerSlot.division)}</span
			>
		</p>
		{#if tournament.status === "setup"}
			<p class="mt-2 text-xs text-tan opacity-80">
				You can withdraw any time before the tournament starts.
			</p>
		{/if}
		<div class="mt-4 flex justify-end gap-2">
			{#if tournament.status === "setup"}
				<button
					type="button"
					class="rounded border border-tan px-3 py-1.5 text-xs text-tan disabled:opacity-50"
					onclick={withdraw}
					disabled={busy}
				>
					Withdraw
				</button>
			{/if}
			<button
				type="button"
				class="rounded border border-tan px-3 py-1.5 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
				onclick={() => (open = false)}
			>
				Close
			</button>
		</div>
	{/if}
</Popover>
