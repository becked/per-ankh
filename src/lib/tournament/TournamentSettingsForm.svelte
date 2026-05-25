<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import {
		ApiError,
		cloudApi,
		type PatchTournamentBody,
		type TournamentDetail,
	} from "$lib/api-cloud";
	import { toast } from "$lib/ui/toast";

	interface Props {
		tournament: TournamentDetail;
		onSaved?: () => void;
		onCancel?: () => void;
	}

	let { tournament, onSaved, onCancel }: Props = $props();

	// Local edit state. Module-scope init from props is enough — both callers
	// either remount on open (modal) or remount via invalidateAll() (inline
	// panel) so we never have to resync mid-life.
	// svelte-ignore state_referenced_locally
	let name = $state(tournament.name);
	// svelte-ignore state_referenced_locally
	let description = $state(tournament.description ?? "");
	// svelte-ignore state_referenced_locally
	let divisionAName = $state(tournament.division_a_name);
	// svelte-ignore state_referenced_locally
	let divisionBName = $state(tournament.division_b_name);
	// svelte-ignore state_referenced_locally
	let swissMaxRounds = $state(tournament.swiss_max_rounds);
	// svelte-ignore state_referenced_locally
	let swissWinsToAdvance = $state(tournament.swiss_wins_to_advance);
	// svelte-ignore state_referenced_locally
	let swissLossesToEliminate = $state(tournament.swiss_losses_to_eliminate);

	let busy = $state(false);

	const swissConfigLocked = $derived(tournament.status !== "setup");

	// FSM-consistency check. Mirrors validateSwissThresholds in
	// cloud/src/tournament/admin.ts — the server still validates, this is
	// just inline feedback so the save button shows why it's disabled.
	const thresholdError = $derived.by(() => {
		if (swissConfigLocked) return null;
		if (swissWinsToAdvance > swissMaxRounds) {
			return `Wins to advance (${swissWinsToAdvance}) cannot exceed max rounds (${swissMaxRounds}).`;
		}
		if (swissWinsToAdvance + swissLossesToEliminate > swissMaxRounds + 1) {
			return `Wins to advance + losses to eliminate (${swissWinsToAdvance + swissLossesToEliminate}) must be ≤ max rounds + 1 (${swissMaxRounds + 1}).`;
		}
		return null;
	});

	function buildPatch(): PatchTournamentBody {
		const patch: PatchTournamentBody = {};
		const trimmedName = name.trim();
		if (trimmedName !== tournament.name) patch.name = trimmedName;
		const trimmedDesc = description.trim() || null;
		if (trimmedDesc !== tournament.description) patch.description = trimmedDesc;
		const trimmedA = divisionAName.trim();
		if (trimmedA !== tournament.division_a_name)
			patch.division_a_name = trimmedA;
		const trimmedB = divisionBName.trim();
		if (trimmedB !== tournament.division_b_name)
			patch.division_b_name = trimmedB;
		if (!swissConfigLocked) {
			if (swissMaxRounds !== tournament.swiss_max_rounds)
				patch.swiss_max_rounds = swissMaxRounds;
			if (swissWinsToAdvance !== tournament.swiss_wins_to_advance)
				patch.swiss_wins_to_advance = swissWinsToAdvance;
			if (swissLossesToEliminate !== tournament.swiss_losses_to_eliminate)
				patch.swiss_losses_to_eliminate = swissLossesToEliminate;
		}
		return patch;
	}

	async function save() {
		const patch = buildPatch();
		if (Object.keys(patch).length === 0) {
			onSaved?.();
			return;
		}
		busy = true;
		try {
			await cloudApi.patchTournament(tournament.tournament_id, patch);
			await invalidateAll();
			toast.info("Saved");
			onSaved?.();
		} catch (err) {
			let message = "Save failed";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			toast.error(message);
		} finally {
			busy = false;
		}
	}

	const canSave = $derived(
		!busy &&
			name.trim() &&
			divisionAName.trim() &&
			divisionBName.trim() &&
			thresholdError === null,
	);
</script>

<div class="flex flex-col gap-3 text-xs text-tan">
	<label class="flex flex-col gap-1">
		<span>Name</span>
		<input
			type="text"
			bind:value={name}
			class="rounded border border-[#4a433b] bg-[#35302b] p-1.5 focus:border-[#5a524a] focus:outline-none"
		/>
	</label>

	<label class="flex flex-col gap-1">
		<span>Description</span>
		<textarea
			bind:value={description}
			rows="2"
			class="rounded border border-[#4a433b] bg-[#35302b] p-1.5 focus:border-[#5a524a] focus:outline-none"
		></textarea>
	</label>

	<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
		<label class="flex flex-col gap-1">
			<span>Division A name</span>
			<input
				type="text"
				bind:value={divisionAName}
				class="rounded border border-[#4a433b] bg-[#35302b] p-1.5 focus:border-[#5a524a] focus:outline-none"
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span>Division B name</span>
			<input
				type="text"
				bind:value={divisionBName}
				class="rounded border border-[#4a433b] bg-[#35302b] p-1.5 focus:border-[#5a524a] focus:outline-none"
			/>
		</label>
	</div>

	<fieldset
		class="rounded border border-black border-opacity-50 p-3"
		disabled={swissConfigLocked}
	>
		<legend class="px-1 text-xs opacity-70">
			Swiss configuration
			{#if swissConfigLocked}
				<span class="ml-1">— locked after start</span>
			{/if}
		</legend>
		<div class="grid grid-cols-1 gap-3 lg:grid-cols-3">
			<label class="flex flex-col gap-1">
				<span>Max rounds</span>
				<input
					type="number"
					min="1"
					max="20"
					bind:value={swissMaxRounds}
					class="no-spinner rounded border border-[#4a433b] bg-[#35302b] p-1.5 focus:border-[#5a524a] focus:outline-none disabled:opacity-50"
				/>
			</label>
			<label class="flex flex-col gap-1">
				<span>Wins to advance</span>
				<input
					type="number"
					min="1"
					max="20"
					bind:value={swissWinsToAdvance}
					class="no-spinner rounded border border-[#4a433b] bg-[#35302b] p-1.5 focus:border-[#5a524a] focus:outline-none disabled:opacity-50"
				/>
			</label>
			<label class="flex flex-col gap-1">
				<span>Losses to eliminate</span>
				<input
					type="number"
					min="1"
					max="20"
					bind:value={swissLossesToEliminate}
					class="no-spinner rounded border border-[#4a433b] bg-[#35302b] p-1.5 focus:border-[#5a524a] focus:outline-none disabled:opacity-50"
				/>
			</label>
		</div>
		{#if thresholdError}
			<p class="mt-2 text-xs text-red-400">{thresholdError}</p>
		{/if}
	</fieldset>
</div>

<div class="mt-4 flex justify-end gap-2">
	{#if onCancel}
		<button
			type="button"
			class="rounded border border-tan px-3 py-1.5 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
			onclick={onCancel}
			disabled={busy}
		>
			Cancel
		</button>
	{/if}
	<button
		type="button"
		class="bg-orange/20 hover:bg-orange/40 rounded border border-tan px-3 py-1.5 text-xs text-tan disabled:opacity-50"
		onclick={save}
		disabled={!canSave}
	>
		Save
	</button>
</div>
