<script lang="ts">
	import {
		cloudApi,
		type MapPoolEntry,
		type TournamentDetail,
	} from "$lib/api-cloud";
	import {
		allMapScriptsByDlc,
		DLC_GROUP_LABELS,
		mapScriptLabel,
	} from "$lib/tournament/map-scripts";
	import MapScriptOptionsBlock from "$lib/tournament/MapScriptOptionsBlock.svelte";
	import {
		defaultsForScript,
		effectiveOptionValue,
		mapOptionChoiceLabel,
		optionsForScript,
	} from "$lib/tournament/map-script-options";
	import Select from "$lib/ui/Select.svelte";
	import { runAction } from "$lib/tournament/async-action";

	interface Props {
		tournament: TournamentDetail;
	}

	let { tournament }: Props = $props();

	// Local optimistic copy of the pool. Cloned so edits don't mutate the prop;
	// rolled back to the prop on a failed save. Mirrors the pattern elsewhere
	// in the tournament admin UI.
	// svelte-ignore state_referenced_locally
	let mapPool = $state<MapPoolEntry[]>(clonePool(tournament.map_pool));

	let saving = $state(false);

	// The picker always lists every script — the same script can be added
	// multiple times with different options (e.g. Continent @ Duel + @ Tiny).
	const mapScriptGroups = allMapScriptsByDlc().map((g) => ({
		heading: DLC_GROUP_LABELS[g.dlc],
		options: g.entries.map((e) => ({ value: e.value, label: e.label })),
	}));

	// Track which instances have their options expanded, keyed by instance id.
	let expanded = $state<Record<string, boolean>>({});
	function toggleExpanded(id: string) {
		expanded[id] = !expanded[id];
	}

	function clonePool(pool: readonly MapPoolEntry[]): MapPoolEntry[] {
		return pool.map((e) => ({ ...e, options: { ...e.options } }));
	}

	// Client-side instance id (16 hex chars) for newly-added entries. Regex-safe
	// for the server schema; the server keeps it rather than reassigning.
	function newInstanceId(): string {
		return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) =>
			b.toString(16).padStart(2, "0"),
		).join("");
	}

	async function commit(next: MapPoolEntry[]) {
		const ok = await runAction(
			() =>
				cloudApi.patchTournament(tournament.tournament_id, { map_pool: next }),
			{
				setBusy: (b) => (saving = b),
				success: "Saved",
				failMessage: "Save failed",
			},
		);
		// Roll back optimistic state so the visible pool matches the server.
		if (ok === null) mapPool = clonePool(tournament.map_pool);
	}

	function addMapScript(script: string) {
		if (!script) return;
		const next = [
			...mapPool,
			{ id: newInstanceId(), script, options: defaultsForScript(script) },
		];
		mapPool = next;
		commit(next);
	}

	function removeInstance(id: string) {
		const next = mapPool.filter((e) => e.id !== id);
		mapPool = next;
		commit(next);
	}

	function setInstanceOptions(
		id: string,
		options: Record<string, string | boolean>,
	) {
		const next = mapPool.map((e) => (e.id === id ? { ...e, options } : e));
		mapPool = next;
		commit(next);
	}
</script>

<section
	class="mb-6 rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<h2 class="mb-3 text-sm font-bold text-tan">Maps</h2>

	<div class="flex flex-col gap-2 text-xs text-tan">
		{#if mapPool.length === 0}
			<p class="text-tan opacity-60">
				None — add at least one before starting the tournament.
			</p>
		{:else}
			<ul class="flex flex-col gap-1.5">
				{#each mapPool as entry (entry.id)}
					{@const optsCount = optionsForScript(entry.script).length}
					{@const isExpanded = expanded[entry.id] === true}
					{@const expandable = optsCount > 0}
					<li
						class="overflow-hidden rounded border border-black bg-surface-raised"
						title={entry.script}
					>
						<div class="flex items-stretch">
							<button
								type="button"
								class="flex flex-1 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-hover disabled:cursor-default disabled:hover:bg-transparent"
								onclick={() => expandable && toggleExpanded(entry.id)}
								disabled={!expandable}
								aria-expanded={expandable ? isExpanded : undefined}
								aria-label={expandable
									? `${isExpanded ? "Collapse" : "Expand"} ${mapScriptLabel(entry.script)} options`
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
								<span class="flex-1 text-xs"
									>{mapScriptLabel(entry.script)}</span
								>
								{#if !isExpanded}
									{@const aspect = effectiveOptionValue(
										entry.options,
										"MAPASPECTRATIO",
									)}
									{@const size = effectiveOptionValue(entry.options, "MAPSIZE")}
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
								class="flex shrink-0 items-center justify-center border-l border-black px-3 text-tan opacity-60 transition-colors hover:bg-surface-hover hover:text-red-400 hover:opacity-100 disabled:opacity-30"
								onclick={() => removeInstance(entry.id)}
								disabled={saving}
								aria-label="Remove {mapScriptLabel(entry.script)}"
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
							<div class="border-t border-black bg-surface px-3 py-2">
								<MapScriptOptionsBlock
									script={entry.script}
									options={entry.options}
									disabled={saving}
									onChange={(options) => setInstanceOptions(entry.id, options)}
								/>
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
			placeholder="Add a map…"
			disabled={saving}
			ariaLabel="Add map script"
			class="mt-1"
		/>
	</div>
</section>
