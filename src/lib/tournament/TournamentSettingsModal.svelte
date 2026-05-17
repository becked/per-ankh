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

	interface Props {
		tournament: TournamentDetail;
		onClose: () => void;
	}

	let { tournament, onClose }: Props = $props();

	// Local edit state. Wrapping the modal in {#if isOpen} at the call site
	// means we get a fresh mount each open, so initialising from props at
	// module scope is enough — no $effect resync needed.
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
	let swissAdvanceCount = $state(tournament.swiss_advance_count ?? 0);
	// svelte-ignore state_referenced_locally
	let allowedMapScripts = $state<string[]>([...tournament.allowed_map_scripts]);

	let busy = $state(false);
	let banner = $state<{ kind: "ok" | "err"; message: string } | null>(null);

	const swissConfigLocked = $derived(tournament.status !== "setup");
	const advanceCountLocked = $derived(
		tournament.status === "championship" || tournament.status === "complete",
	);

	const unaddedGroups = $derived(unaddedMapScriptsByDlc(allowedMapScripts));

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
		if (!advanceCountLocked) {
			if (swissAdvanceCount !== (tournament.swiss_advance_count ?? 0))
				patch.swiss_advance_count = swissAdvanceCount;
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
			onClose();
			return;
		}
		busy = true;
		banner = null;
		try {
			await cloudApi.patchTournament(tournament.tournament_id, patch);
			await invalidateAll();
			onClose();
		} catch (err) {
			let message = "Save failed";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			banner = { kind: "err", message };
		} finally {
			busy = false;
		}
	}

	const canSave = $derived(
		!busy && name.trim() && divisionAName.trim() && divisionBName.trim(),
	);

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape" && !busy) {
			e.preventDefault();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
	onclick={onClose}
	role="presentation"
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border-2 border-black bg-blue-gray p-5 shadow-lg"
		onclick={(e) => e.stopPropagation()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="settings-modal-title"
		tabindex="-1"
	>
		<header class="mb-4 flex items-baseline justify-between gap-3">
			<h2
				id="settings-modal-title"
				class="border-b-2 border-orange pb-1 text-lg font-bold text-tan"
			>
				Tournament settings
			</h2>
			<button
				type="button"
				class="text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100"
				onclick={onClose}
				aria-label="Close"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M6 18L18 6M6 6l12 12"
					/>
				</svg>
			</button>
		</header>

		{#if banner}
			<div
				class="mb-3 rounded border px-3 py-2 text-sm"
				class:border-red-500={banner.kind === "err"}
				class:text-red-400={banner.kind === "err"}
				role="status"
			>
				{banner.message}
			</div>
		{/if}

		<div class="flex flex-col gap-3 text-xs text-tan">
			<label class="flex flex-col gap-1">
				<span>Name</span>
				<input
					type="text"
					bind:value={name}
					class="rounded border border-black bg-[#35302b] p-1.5"
				/>
			</label>

			<label class="flex flex-col gap-1">
				<span>Description</span>
				<textarea
					bind:value={description}
					rows="2"
					class="rounded border border-black bg-[#35302b] p-1.5"
				></textarea>
			</label>

			<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
				<label class="flex flex-col gap-1">
					<span>Division A name</span>
					<input
						type="text"
						bind:value={divisionAName}
						class="rounded border border-black bg-[#35302b] p-1.5"
					/>
				</label>
				<label class="flex flex-col gap-1">
					<span>Division B name</span>
					<input
						type="text"
						bind:value={divisionBName}
						class="rounded border border-black bg-[#35302b] p-1.5"
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
							bind:value={swissMaxRounds}
							class="rounded border border-black bg-[#35302b] p-1.5 disabled:opacity-50"
						/>
					</label>
					<label class="flex flex-col gap-1">
						<span>Wins to advance</span>
						<input
							type="number"
							min="1"
							bind:value={swissWinsToAdvance}
							class="rounded border border-black bg-[#35302b] p-1.5 disabled:opacity-50"
						/>
					</label>
					<label class="flex flex-col gap-1">
						<span>Losses to eliminate</span>
						<input
							type="number"
							min="1"
							bind:value={swissLossesToEliminate}
							class="rounded border border-black bg-[#35302b] p-1.5 disabled:opacity-50"
						/>
					</label>
				</div>
			</fieldset>

			<label class="flex flex-col gap-1">
				<span>
					Championship advancers per division
					{#if advanceCountLocked}
						<span class="ml-1 opacity-70">— locked after transition</span>
					{/if}
				</span>
				<input
					type="number"
					min="0"
					bind:value={swissAdvanceCount}
					disabled={advanceCountLocked}
					class="rounded border border-black bg-[#35302b] p-1.5 disabled:opacity-50"
				/>
			</label>

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
				<select
					value=""
					onchange={(e) => {
						const target = e.target as HTMLSelectElement;
						addMapScript(target.value);
						target.value = "";
					}}
					disabled={busy || unaddedGroups.length === 0}
					class="mt-1 rounded border border-black bg-[#35302b] p-1.5 disabled:opacity-50"
					aria-label="Add map script"
				>
					<option value="" disabled>
						{unaddedGroups.length === 0 ? "All known maps added" : "Add a map…"}
					</option>
					{#each unaddedGroups as group (group.dlc)}
						<optgroup label={DLC_GROUP_LABELS[group.dlc]}>
							{#each group.entries as entry (entry.value)}
								<option value={entry.value}>{entry.label}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</div>
		</div>

		<div class="mt-4 flex justify-end gap-2">
			<button
				type="button"
				class="rounded border border-brown px-3 py-1.5 text-xs text-tan transition-colors hover:bg-brown disabled:opacity-50"
				onclick={onClose}
				disabled={busy}
			>
				Cancel
			</button>
			<button
				type="button"
				class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs text-tan disabled:opacity-50"
				onclick={save}
				disabled={!canSave}
			>
				Save
			</button>
		</div>
	</div>
</div>
