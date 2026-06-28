<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import {
		ApiError,
		cloudApi,
		type PatchTournamentBody,
		type TournamentDetail,
	} from "$lib/api-cloud";
	import { toast } from "$lib/ui/toast";
	import TournamentLinksEditor from "./TournamentLinksEditor.svelte";

	interface Props {
		tournament: TournamentDetail;
		// When false the form renders read-only: inputs disabled. Non-admins can
		// open settings but cannot change anything.
		canEdit?: boolean;
	}

	let { tournament, canEdit = true }: Props = $props();

	// Local edit state. The modal remounts on open and re-syncs via
	// invalidateAll() after each commit, so module-scope init from props is enough.
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

	// This form is only mounted once the tournament has started (in setup the
	// on-page Overview/Configuration panels cover these fields). So the Swiss
	// config is always locked here — shown read-only.
	const swissConfigLocked = $derived(tournament.status !== "setup");

	// Commit-on-blur, matching the on-page Overview/Configuration panels. The
	// modal's close button is the only "cancel" — there's nothing to discard
	// since each field persists as you leave it.
	async function commit(patch: PatchTournamentBody) {
		if (Object.keys(patch).length === 0) return;
		try {
			await cloudApi.patchTournament(tournament.tournament_id, patch);
			await invalidateAll();
			toast.info("Saved");
		} catch (err) {
			let message = "Save failed";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			toast.error(message);
		}
	}

	function commitName() {
		const trimmed = name.trim();
		if (!trimmed) {
			name = tournament.name; // empty name not allowed — revert
			return;
		}
		if (trimmed === tournament.name) return;
		commit({ name: trimmed });
	}

	function commitDescription() {
		const next = description.trim() || null;
		if (next === tournament.description) return;
		commit({ description: next });
	}

	function commitDivisionA() {
		const trimmed = divisionAName.trim();
		if (!trimmed) {
			divisionAName = tournament.division_a_name;
			return;
		}
		if (trimmed === tournament.division_a_name) return;
		commit({ division_a_name: trimmed });
	}

	function commitDivisionB() {
		const trimmed = divisionBName.trim();
		if (!trimmed) {
			divisionBName = tournament.division_b_name;
			return;
		}
		if (trimmed === tournament.division_b_name) return;
		commit({ division_b_name: trimmed });
	}
</script>

<div class="flex flex-col gap-3 text-xs text-tan">
	<label class="flex flex-col gap-1">
		<span>Name</span>
		<input
			type="text"
			bind:value={name}
			onblur={commitName}
			disabled={!canEdit}
			class="rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none disabled:opacity-50"
		/>
	</label>

	<label class="flex flex-col gap-1">
		<span>Description</span>
		<textarea
			bind:value={description}
			onblur={commitDescription}
			rows="2"
			disabled={!canEdit}
			class="rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none disabled:opacity-50"
		></textarea>
	</label>

	<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
		<label class="flex flex-col gap-1">
			<span>Division A name</span>
			<input
				type="text"
				bind:value={divisionAName}
				onblur={commitDivisionA}
				disabled={!canEdit}
				class="rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none disabled:opacity-50"
			/>
		</label>
		<label class="flex flex-col gap-1">
			<span>Division B name</span>
			<input
				type="text"
				bind:value={divisionBName}
				onblur={commitDivisionB}
				disabled={!canEdit}
				class="rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none disabled:opacity-50"
			/>
		</label>
	</div>

	<fieldset
		class="rounded border border-black border-opacity-50 p-3"
		disabled={swissConfigLocked || !canEdit}
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
					class="no-spinner rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none disabled:opacity-50"
				/>
			</label>
			<label class="flex flex-col gap-1">
				<span>Wins to advance</span>
				<input
					type="number"
					min="1"
					max="20"
					bind:value={swissWinsToAdvance}
					class="no-spinner rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none disabled:opacity-50"
				/>
			</label>
			<label class="flex flex-col gap-1">
				<span>Losses to eliminate</span>
				<input
					type="number"
					min="1"
					max="20"
					bind:value={swissLossesToEliminate}
					class="no-spinner rounded border border-input bg-surface-raised p-1.5 focus:border-input-focus focus:outline-none disabled:opacity-50"
				/>
			</label>
		</div>
	</fieldset>

	<TournamentLinksEditor {tournament} {canEdit} />
</div>
