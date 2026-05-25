<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { ApiError, cloudApi, type TournamentDetail } from "$lib/api-cloud";
	import {
		DLC_GROUP_LABELS,
		mapScriptLabel,
		unaddedMapScriptsByDlc,
	} from "$lib/tournament/map-scripts";
	import MapScriptOptionsBlock from "$lib/tournament/MapScriptOptionsBlock.svelte";
	import {
		effectiveOptionValue,
		mapOptionChoiceLabel,
		optionsForScript,
	} from "$lib/tournament/map-script-options";
	import Select from "$lib/ui/Select.svelte";
	import { toast } from "$lib/ui/toast";

	interface Props {
		tournament: TournamentDetail;
	}

	let { tournament }: Props = $props();

	// svelte-ignore state_referenced_locally
	let allowedMapScripts = $state<string[]>([...tournament.allowed_map_scripts]);

	let saving = $state(false);

	const unaddedGroups = $derived(unaddedMapScriptsByDlc(allowedMapScripts));
	const mapScriptGroups = $derived(
		unaddedGroups.map((g) => ({
			heading: DLC_GROUP_LABELS[g.dlc],
			options: g.entries.map((e) => ({ value: e.value, label: e.label })),
		})),
	);

	// Track which scripts have their options expanded. Local-only state;
	// resets on remount, intentional (no per-user persistence needed).
	let expanded = $state<Record<string, boolean>>({});
	function toggleExpanded(script: string) {
		expanded[script] = !expanded[script];
	}

	async function commit(next: string[]) {
		saving = true;
		try {
			await cloudApi.patchTournament(tournament.tournament_id, {
				allowed_map_scripts: next,
			});
			await invalidateAll();
			toast.info("Saved");
		} catch (err) {
			let message = "Save failed";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			toast.error(message);
			// Roll back optimistic state so the visible list matches the server.
			allowedMapScripts = [...tournament.allowed_map_scripts];
		} finally {
			saving = false;
		}
	}

	function addMapScript(value: string) {
		if (!value || allowedMapScripts.includes(value)) return;
		const next = [...allowedMapScripts, value];
		allowedMapScripts = next;
		commit(next);
	}

	function removeMapScript(script: string) {
		const next = allowedMapScripts.filter((s) => s !== script);
		allowedMapScripts = next;
		commit(next);
	}
</script>

<section class="mb-6 rounded-lg p-4" style="background-color: #2a2622;">
	<h2 class="mb-3 text-sm font-bold text-tan">Maps</h2>

	<div class="flex flex-col gap-2 text-xs text-tan">
		{#if allowedMapScripts.length === 0}
			<p class="text-tan opacity-60">
				None — add at least one before starting the tournament.
			</p>
		{:else}
			<ul class="flex flex-col gap-1.5">
				{#each allowedMapScripts as script (script)}
					{@const optsCount = optionsForScript(script).length}
					{@const isExpanded = expanded[script] === true}
					{@const expandable = optsCount > 0}
					<li
						class="overflow-hidden rounded border border-black bg-[#35302b]"
						title={script}
					>
						<div class="flex items-stretch">
							<button
								type="button"
								class="flex flex-1 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[#3d3832] disabled:cursor-default disabled:hover:bg-transparent"
								onclick={() => expandable && toggleExpanded(script)}
								disabled={!expandable}
								aria-expanded={expandable ? isExpanded : undefined}
								aria-label={expandable
									? `${isExpanded ? "Collapse" : "Expand"} ${mapScriptLabel(script)} options`
									: undefined}
							>
								{#if expandable}
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-4 w-4 shrink-0 text-tan opacity-70 transition-transform"
										class:rotate-90={isExpanded}
										viewBox="0 0 20 20"
										fill="currentColor"
										aria-hidden="true"
									>
										<path
											fill-rule="evenodd"
											d="M7.21 14.77a.75.75 0 010-1.06L10.94 10 7.21 6.29a.75.75 0 111.06-1.06l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-.02z"
											clip-rule="evenodd"
										/>
									</svg>
								{:else}
									<span class="inline-block h-4 w-4 shrink-0" aria-hidden="true"
									></span>
								{/if}
								<span class="flex-1 text-sm">{mapScriptLabel(script)}</span>
								{#if !isExpanded}
									{@const aspect = effectiveOptionValue(
										tournament.map_script_options,
										script,
										"MAPASPECTRATIO",
									)}
									{@const size = effectiveOptionValue(
										tournament.map_script_options,
										script,
										"MAPSIZE",
									)}
									<span class="text-[11px] text-tan opacity-70">
										{mapOptionChoiceLabel("MAPASPECTRATIO", aspect)}
										{mapOptionChoiceLabel("MAPSIZE", size)}
									</span>
								{/if}
								{#if expandable}
									<span class="text-[10px] text-tan opacity-50">
										{optsCount} option{optsCount === 1 ? "" : "s"}
									</span>
								{/if}
							</button>
							<button
								type="button"
								class="flex shrink-0 items-center justify-center border-l border-black px-3 text-tan opacity-60 transition-colors hover:bg-[#3d3832] hover:text-red-400 hover:opacity-100 disabled:opacity-30"
								onclick={() => removeMapScript(script)}
								disabled={saving}
								aria-label="Remove {mapScriptLabel(script)}"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-4 w-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
									aria-hidden="true"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</button>
						</div>
						{#if isExpanded && expandable}
							<div class="border-t border-black bg-[#2a2622] px-3 py-2">
								<MapScriptOptionsBlock {tournament} {script} />
							</div>
						{/if}
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
			disabled={saving || unaddedGroups.length === 0}
			ariaLabel="Add map script"
			class="mt-1"
		/>
	</div>
</section>
