<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import {
		ApiError,
		cloudApi,
		type TournamentDetail,
	} from "$lib/api-cloud";
	import {
		DLC_GROUP_LABELS,
		mapScriptLabel,
		unaddedMapScriptsByDlc,
	} from "$lib/tournament/map-scripts";

	interface Props {
		tournament: TournamentDetail;
	}

	let { tournament }: Props = $props();

	// svelte-ignore state_referenced_locally
	let allowedMapScripts = $state<string[]>([...tournament.allowed_map_scripts]);

	let status = $state<
		| { kind: "idle" }
		| { kind: "saving" }
		| { kind: "saved" }
		| { kind: "err"; message: string }
	>({ kind: "idle" });

	const unaddedGroups = $derived(unaddedMapScriptsByDlc(allowedMapScripts));

	async function commit(next: string[]) {
		status = { kind: "saving" };
		try {
			await cloudApi.patchTournament(tournament.tournament_id, {
				allowed_map_scripts: next,
			});
			await invalidateAll();
			status = { kind: "saved" };
		} catch (err) {
			let message = "Save failed";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			status = { kind: "err", message };
			// Roll back optimistic state so the visible list matches the server.
			allowedMapScripts = [...tournament.allowed_map_scripts];
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
	<header class="mb-3 flex items-baseline justify-between">
		<h2 class="text-sm font-bold text-tan">Maps</h2>
		{#if status.kind === "saving"}
			<span class="text-xs text-tan opacity-60">Saving…</span>
		{:else if status.kind === "saved"}
			<span class="text-xs text-orange opacity-80">Saved</span>
		{:else if status.kind === "err"}
			<span class="text-xs text-red-400">{status.message}</span>
		{/if}
	</header>

	<div class="flex flex-col gap-2 text-xs text-tan">
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
							disabled={status.kind === "saving"}
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
			disabled={status.kind === "saving" || unaddedGroups.length === 0}
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
</section>
