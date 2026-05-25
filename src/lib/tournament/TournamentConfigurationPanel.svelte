<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import {
		ApiError,
		cloudApi,
		type PatchTournamentBody,
		type TournamentDetail,
	} from "$lib/api-cloud";
	import Checkbox from "$lib/ui/Checkbox.svelte";

	interface Props {
		tournament: TournamentDetail;
		divACount: number;
		divBCount: number;
	}

	let { tournament, divACount, divBCount }: Props = $props();

	// svelte-ignore state_referenced_locally
	let signupsOpen = $state(tournament.signups_open);
	// svelte-ignore state_referenced_locally
	let swissMaxRounds = $state(tournament.swiss_max_rounds);
	// svelte-ignore state_referenced_locally
	let swissWinsToAdvance = $state(tournament.swiss_wins_to_advance);
	// svelte-ignore state_referenced_locally
	let swissLossesToEliminate = $state(tournament.swiss_losses_to_eliminate);

	// FSM-consistency: mirror validateSwissThresholds in
	// cloud/src/tournament/admin.ts. Server validates on every PATCH so
	// this is feedback-only.
	const thresholdError = $derived.by(() => {
		if (swissWinsToAdvance > swissMaxRounds) {
			return `Wins to advance (${swissWinsToAdvance}) cannot exceed max rounds (${swissMaxRounds}).`;
		}
		if (swissWinsToAdvance + swissLossesToEliminate > swissMaxRounds + 1) {
			return `Wins + losses (${swissWinsToAdvance + swissLossesToEliminate}) must be ≤ max rounds + 1 (${swissMaxRounds + 1}). Some players could finish Swiss with no verdict.`;
		}
		return null;
	});

	// Soft hint on likely qualifier count given current settings + division
	// sizes. The actual count depends on tournament play (forfeits, byes,
	// W/L distribution), so this is a rough preview, not a guarantee.
	const expectedQualifiers = $derived.by(() => {
		// Rough heuristic: each division produces (slotsPerDiv * winsToAdvance /
		// (winsToAdvance + lossesToEliminate)) qualifiers in steady state.
		// Round bounds.
		const denom = swissWinsToAdvance + swissLossesToEliminate;
		if (denom === 0) return null;
		const perDiv = (divACount * swissWinsToAdvance) / denom;
		const total = perDiv + (divBCount * swissWinsToAdvance) / denom;
		const low = Math.max(2, Math.floor(total * 0.6));
		const high = Math.min(divACount + divBCount, Math.ceil(total * 1.1));
		if (low > high) return null;
		return { low, high };
	});

	let status = $state<
		| { kind: "idle" }
		| { kind: "saving" }
		| { kind: "saved" }
		| { kind: "err"; message: string }
	>({ kind: "idle" });

	async function commit(patch: PatchTournamentBody) {
		if (Object.keys(patch).length === 0) return;
		status = { kind: "saving" };
		try {
			await cloudApi.patchTournament(tournament.tournament_id, patch);
			await invalidateAll();
			status = { kind: "saved" };
		} catch (err) {
			let message = "Save failed";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			status = { kind: "err", message };
		}
	}

	function clampToRange(raw: unknown, min: number, max: number): number | null {
		if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
		const n = Math.trunc(raw);
		if (n < min || n > max) return null;
		return n;
	}

	function commitMaxRounds() {
		const next = clampToRange(swissMaxRounds, 1, 20);
		if (next === null) {
			swissMaxRounds = tournament.swiss_max_rounds;
			return;
		}
		swissMaxRounds = next;
		if (next === tournament.swiss_max_rounds) return;
		// Skip the commit if the new value would fail server validation;
		// surface the error inline instead of taking the 400 round-trip.
		if (thresholdError) return;
		commit({ swiss_max_rounds: next });
	}

	function commitWinsToAdvance() {
		const next = clampToRange(swissWinsToAdvance, 1, 20);
		if (next === null) {
			swissWinsToAdvance = tournament.swiss_wins_to_advance;
			return;
		}
		swissWinsToAdvance = next;
		if (next === tournament.swiss_wins_to_advance) return;
		if (thresholdError) return;
		commit({ swiss_wins_to_advance: next });
	}

	function commitLossesToEliminate() {
		const next = clampToRange(swissLossesToEliminate, 1, 20);
		if (next === null) {
			swissLossesToEliminate = tournament.swiss_losses_to_eliminate;
			return;
		}
		swissLossesToEliminate = next;
		if (next === tournament.swiss_losses_to_eliminate) return;
		if (thresholdError) return;
		commit({ swiss_losses_to_eliminate: next });
	}

	async function commitSignupsOpen(next: boolean) {
		// Optimistic — flip the local state so the checkbox is responsive,
		// then PATCH. invalidateAll re-syncs from the canonical row; on
		// failure we restore from the tournament prop.
		signupsOpen = next;
		await commit({ signups_open: next });
		if (status.kind === "err") signupsOpen = tournament.signups_open;
	}
</script>

<section class="mb-6 rounded-lg p-4" style="background-color: #2a2622;">
	<header class="mb-3 flex items-baseline justify-between">
		<h2 class="text-sm font-bold text-tan">Signups</h2>
		{#if status.kind === "saving"}
			<span class="text-xs text-tan opacity-60">Saving…</span>
		{:else if status.kind === "saved"}
			<span class="text-xs text-orange opacity-80">Saved</span>
		{:else if status.kind === "err"}
			<span class="text-xs text-red-400">{status.message}</span>
		{/if}
	</header>

	<div
		class="mb-4 rounded-lg p-3 text-xs text-tan"
		style="background-color: #35302B;"
	>
		<Checkbox
			checked={signupsOpen}
			onCheckedChange={(c) => commitSignupsOpen(c)}
			disabled={status.kind === "saving"}
		>
			<span>Open for signups</span>
		</Checkbox>
		<p class="mt-1 text-[11px] text-tan opacity-60">
			When open, any signed-in player can sign up. Closes automatically when you
			start the tournament.
		</p>
	</div>

	<header class="mb-3 flex items-baseline justify-between">
		<h2 class="text-sm font-bold text-tan">Swiss configuration</h2>
	</header>

	<div
		class="rounded-lg p-3 text-xs text-tan"
		style="background-color: #35302B;"
	>
		<div class="grid grid-cols-1 gap-3 lg:grid-cols-3">
			<label class="flex flex-col gap-1">
				<span>Max rounds</span>
				<input
					type="number"
					min="1"
					max="20"
					bind:value={swissMaxRounds}
					onblur={commitMaxRounds}
					class="no-spinner rounded border border-black bg-[#35302b] p-1.5"
				/>
			</label>
			<label class="flex flex-col gap-1">
				<span>Wins to advance</span>
				<input
					type="number"
					min="1"
					max="20"
					bind:value={swissWinsToAdvance}
					onblur={commitWinsToAdvance}
					class="no-spinner rounded border border-black bg-[#35302b] p-1.5"
				/>
			</label>
			<label class="flex flex-col gap-1">
				<span>Losses to eliminate</span>
				<input
					type="number"
					min="1"
					max="20"
					bind:value={swissLossesToEliminate}
					onblur={commitLossesToEliminate}
					class="no-spinner rounded border border-black bg-[#35302b] p-1.5"
				/>
			</label>
		</div>
		{#if thresholdError}
			<p class="mt-2 text-[11px] text-red-400">{thresholdError}</p>
		{:else if expectedQualifiers}
			<p class="mt-2 text-[11px] text-tan opacity-60">
				With {divACount + divBCount} slots, expect roughly {expectedQualifiers.low}–{expectedQualifiers.high}
				qualifiers reaching the championship bracket. Anyone hitting the win threshold
				advances; tiebreakers only seed the bracket.
			</p>
		{/if}
	</div>
</section>
