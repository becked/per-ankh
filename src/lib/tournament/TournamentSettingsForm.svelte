<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import {
		ApiError,
		cloudApi,
		type PatchTournamentBody,
		type TournamentDetail,
	} from "$lib/api-cloud";
	import {
		DLC_GROUP_LABELS,
		mapScriptLabel,
		unaddedMapScriptsByDlc,
	} from "$lib/tournament/map-scripts";
	import Select from "$lib/ui/Select.svelte";
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
	// svelte-ignore state_referenced_locally
	let allowedMapScripts = $state<string[]>([...tournament.allowed_map_scripts]);

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

	const unaddedGroups = $derived(unaddedMapScriptsByDlc(allowedMapScripts));
	const mapScriptGroups = $derived(
		unaddedGroups.map((g) => ({
			heading: DLC_GROUP_LABELS[g.dlc],
			options: g.entries.map((e) => ({ value: e.value, label: e.label })),
		})),
	);

	function addMapScript(value: string) {
		if (!value) return;
		if (!allowedMapScripts.includes(value)) {
			allowedMapScripts = [...allowedMapScripts, value];
		}
	}

	function removeMapScript(script: string) {
		allowedMapScripts = allowedMapScripts.filter((s) => s !== script);
	}

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
		const oldScripts = tournament.allowed_map_scripts;
		const scriptsChanged =
			allowedMapScripts.length !== oldScripts.length ||
			allowedMapScripts.some((s, i) => s !== oldScripts[i]);
		if (scriptsChanged) patch.allowed_map_scripts = allowedMapScripts;
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

	<div class="flex flex-col gap-2">
		<span>Allowed map scripts</span>
		{#if allowedMapScripts.length === 0}
			<p class="text-tan opacity-60">
				None — add at least one before starting the tournament.
			</p>
		{:else}
			<ul class="flex flex-wrap gap-1.5">
				{#each allowedMapScripts as script (script)}
					<li
						class="inline-flex items-center gap-1.5 rounded border border-black bg-[#35302b] py-0.5 pl-2 pr-1"
						title={script}
					>
						<span>{mapScriptLabel(script)}</span>
						<button
							type="button"
							class="text-tan opacity-60 transition-colors hover:text-red-400 hover:opacity-100 disabled:opacity-30"
							onclick={() => removeMapScript(script)}
							disabled={busy}
							aria-label="Remove {mapScriptLabel(script)}"
						>
							×
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		<Select
			value=""
			onChange={(v) => {
				if (v) addMapScript(v);
			}}
			options={mapScriptGroups}
			resetAfterSelect
			placeholder={unaddedGroups.length === 0
				? "All known maps added"
				: "Add a map…"}
			disabled={busy || unaddedGroups.length === 0}
			ariaLabel="Add map script"
			class="mt-1"
		/>
	</div>
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
		class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs text-tan disabled:opacity-50"
		onclick={save}
		disabled={!canSave}
	>
		Save
	</button>
</div>
