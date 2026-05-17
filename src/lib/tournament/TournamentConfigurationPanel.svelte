<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import {
		ApiError,
		cloudApi,
		type PatchTournamentBody,
		type TournamentDetail,
	} from "$lib/api-cloud";

	interface Props {
		tournament: TournamentDetail;
		divACount: number;
		divBCount: number;
	}

	let { tournament, divACount, divBCount }: Props = $props();

	// svelte-ignore state_referenced_locally
	let swissMaxRounds = $state(tournament.swiss_max_rounds);
	// svelte-ignore state_referenced_locally
	let swissWinsToAdvance = $state(tournament.swiss_wins_to_advance);
	// svelte-ignore state_referenced_locally
	let swissLossesToEliminate = $state(tournament.swiss_losses_to_eliminate);
	// svelte-ignore state_referenced_locally
	let swissAdvanceCount = $state(tournament.swiss_advance_count ?? 1);

	// Advancers ≤ smaller-division size is checked at Start (admin.ts
	// ADVANCE_COUNT_TOO_LARGE). Show "Max {smallerDiv}" live so the admin
	// notices before hitting Start; it goes red when the value exceeds the
	// cap. Updates as slots are added/removed since the counts flow in as
	// props.
	const smallerDiv = $derived(Math.min(divACount, divBCount));
	const exceedsCap = $derived(swissAdvanceCount > smallerDiv);

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

	// Bounds mirror the Valibot PatchTournamentSchema. The smaller-division
	// constraint on advance count is a soft hint only (see template); we
	// don't clamp because slot counts are a moving target during setup.
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
		commit({ swiss_losses_to_eliminate: next });
	}

	function commitAdvanceCount() {
		const next = clampToRange(swissAdvanceCount, 1, 64);
		if (next === null) {
			swissAdvanceCount = tournament.swiss_advance_count ?? 1;
			return;
		}
		swissAdvanceCount = next;
		if (next === (tournament.swiss_advance_count ?? 1)) return;
		commit({ swiss_advance_count: next });
	}
</script>

<section class="mb-6 rounded-lg p-4" style="background-color: #2a2622;">
	<header class="mb-3 flex items-baseline justify-between">
		<h2 class="text-sm font-bold text-tan">Configuration</h2>
		{#if status.kind === "saving"}
			<span class="text-xs text-tan opacity-60">Saving…</span>
		{:else if status.kind === "saved"}
			<span class="text-xs text-orange opacity-80">Saved</span>
		{:else if status.kind === "err"}
			<span class="text-xs text-red-400">{status.message}</span>
		{/if}
	</header>

	<div class="grid grid-cols-1 gap-3 text-xs text-tan lg:grid-cols-2">
		<div class="rounded-lg p-3" style="background-color: #35302B;">
			<h3 class="mb-2 text-xs uppercase text-tan opacity-70">Swiss</h3>
			<div class="flex flex-col gap-3">
				<label class="flex flex-col gap-1">
					<span>Max rounds</span>
					<input
						type="number"
						min="1"
						max="20"
						bind:value={swissMaxRounds}
						onblur={commitMaxRounds}
						class="rounded border border-black bg-[#35302b] p-1.5"
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
						class="rounded border border-black bg-[#35302b] p-1.5"
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
						class="rounded border border-black bg-[#35302b] p-1.5"
					/>
				</label>
			</div>
		</div>

		<div class="rounded-lg p-3" style="background-color: #35302B;">
			<h3 class="mb-2 text-xs uppercase text-tan opacity-70">Championship</h3>
			<div class="flex flex-col gap-3">
				<label class="flex flex-col gap-1">
					<span>Advancers per division</span>
					<input
						type="number"
						min="1"
						max="64"
						bind:value={swissAdvanceCount}
						onblur={commitAdvanceCount}
						class="rounded border border-black bg-[#35302b] p-1.5"
					/>
					<span
						class="text-[10px]"
						class:text-red-400={exceedsCap}
						class:text-tan={!exceedsCap}
						class:opacity-60={!exceedsCap}
					>
						Max {smallerDiv}
					</span>
				</label>
			</div>
		</div>
	</div>
</section>
