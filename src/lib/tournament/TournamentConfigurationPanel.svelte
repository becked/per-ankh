<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import {
		ApiError,
		cloudApi,
		type PatchTournamentBody,
		type TournamentDetail,
	} from "$lib/api-cloud";
	import Checkbox from "$lib/ui/Checkbox.svelte";
	import { toast } from "$lib/ui/toast";

	interface Props {
		tournament: TournamentDetail;
		divACount: number;
		divBCount: number;
	}

	let { tournament, divACount, divBCount }: Props = $props();

	// svelte-ignore state_referenced_locally
	let signupsOpen = $state(tournament.signups_open);
	// svelte-ignore state_referenced_locally
	let signupQuestion = $state(tournament.signup_question ?? "");
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

	let saving = $state(false);

	// Returns whether the patch committed cleanly, so optimistic callers
	// (commitSignupsOpen) can roll back their local state on failure.
	async function commit(patch: PatchTournamentBody): Promise<boolean> {
		if (Object.keys(patch).length === 0) return true;
		saving = true;
		try {
			await cloudApi.patchTournament(tournament.tournament_id, patch);
			await invalidateAll();
			toast.info("Saved");
			return true;
		} catch (err) {
			let message = "Save failed";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			toast.error(message);
			return false;
		} finally {
			saving = false;
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
		const ok = await commit({ signups_open: next });
		if (!ok) signupsOpen = tournament.signups_open;
	}

	// Commit on blur, mirroring the swiss-config inputs. Empty → null clears the
	// question (same nullable-clear pattern as description).
	function commitSignupQuestion() {
		const next = signupQuestion.trim() || null;
		if (next === (tournament.signup_question ?? null)) return;
		commit({ signup_question: next });
	}
</script>

<section class="mb-6 rounded-lg p-4" style="background-color: #2a2622;">
	<h2 class="mb-3 text-sm font-bold text-tan">Signups</h2>

	<div class="flex flex-col gap-3 text-xs text-tan">
		<div>
			<Checkbox
				checked={signupsOpen}
				onCheckedChange={(c) => commitSignupsOpen(c)}
				disabled={saving}
			>
				<span>Open for signups</span>
			</Checkbox>
			<p class="mt-1 text-[11px] text-tan opacity-60">
				When open, any signed-in player can sign up. Closes automatically when
				you start the tournament.
			</p>
		</div>

		<label class="flex flex-col gap-1">
			<span>Signup question</span>
			<textarea
				bind:value={signupQuestion}
				onblur={commitSignupQuestion}
				rows="2"
				maxlength="2000"
				disabled={saving}
				class="rounded border border-[#4a433b] bg-[#35302b] p-1.5 focus:border-[#5a524a] focus:outline-none disabled:opacity-50"
			></textarea>
			<span class="text-[11px] text-tan opacity-60"
				>Optional freeform prompt shown on the signup form (e.g. "What timezone
				and time of day do you want to play?"). Leave blank for none.</span
			>
		</label>
	</div>

	<header class="mb-3 mt-6 flex items-baseline justify-between">
		<h2 class="text-sm font-bold text-tan">Swiss configuration</h2>
	</header>

	<div class="text-xs text-tan">
		<div class="grid grid-cols-1 gap-3 lg:grid-cols-3">
			<label class="flex flex-col gap-1">
				<span>Max rounds</span>
				<input
					type="number"
					min="1"
					max="20"
					bind:value={swissMaxRounds}
					onblur={commitMaxRounds}
					class="no-spinner rounded border border-[#4a433b] bg-[#35302b] p-1.5 focus:border-[#5a524a] focus:outline-none"
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
					class="no-spinner rounded border border-[#4a433b] bg-[#35302b] p-1.5 focus:border-[#5a524a] focus:outline-none"
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
					class="no-spinner rounded border border-[#4a433b] bg-[#35302b] p-1.5 focus:border-[#5a524a] focus:outline-none"
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
