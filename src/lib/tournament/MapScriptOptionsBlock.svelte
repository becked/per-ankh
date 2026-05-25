<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import {
		ApiError,
		cloudApi,
		type MapScriptOptions,
		type TournamentDetail,
	} from "$lib/api-cloud";
	import {
		effectiveOptionValue,
		mapOptionLabel,
		optionDef,
		optionsForScript,
	} from "$lib/tournament/map-script-options";
	import Checkbox from "$lib/ui/Checkbox.svelte";
	import Select from "$lib/ui/Select.svelte";
	import { toast } from "$lib/ui/toast";

	interface Props {
		tournament: TournamentDetail;
		script: string;
	}

	let { tournament, script }: Props = $props();

	// Local working copy. svelte-ignore on the initial read mirrors the
	// pattern in TournamentMapsPanel.svelte:21 — we want the initial value
	// from the prop but then keep our own optimistic state.
	//
	// $state.snapshot (not structuredClone) is required when cloning a value
	// that is, or will become, a $state proxy: structuredClone trips on the
	// proxy's internals with a DataCloneError ("Window could not be cloned").
	// svelte-ignore state_referenced_locally
	let working = $state<MapScriptOptions>(
		$state.snapshot(tournament.map_script_options),
	);

	let saving = $state(false);

	const scriptOptions = $derived(optionsForScript(script));

	async function commit(next: MapScriptOptions) {
		saving = true;
		try {
			await cloudApi.patchTournament(tournament.tournament_id, {
				map_script_options: next,
			});
			await invalidateAll();
			toast.info("Saved");
		} catch (err) {
			let message = "Save failed";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			toast.error(message);
			// Roll back to server state.
			working = $state.snapshot(tournament.map_script_options);
		} finally {
			saving = false;
		}
	}

	function setOption(option: string, value: string | boolean) {
		const next: MapScriptOptions = $state.snapshot(working);
		if (!next[script]) next[script] = {};
		next[script][option] = value;
		working = next;
		commit(next);
	}

	function currentValue(option: string): string | boolean {
		return effectiveOptionValue(working, script, option);
	}
</script>

<div class="flex flex-col gap-1.5">
	{#if scriptOptions.length === 0}
		<p class="text-xs text-tan opacity-60">No options for this script.</p>
	{:else}
		{#each scriptOptions as option (option)}
			{@const def = optionDef(option)}
			{#if def}
				<div class="flex items-center justify-between gap-2 text-xs text-tan">
					<span class="opacity-80">{mapOptionLabel(option)}</span>
					{#if def.kind === "toggle"}
						<Checkbox
							checked={currentValue(option) === true}
							disabled={saving}
							onCheckedChange={(c) => setOption(option, c)}
						/>
					{:else}
						<Select
							value={String(currentValue(option) ?? "")}
							onChange={(v) => v != null && setOption(option, v)}
							options={def.choices}
							disabled={saving}
							ariaLabel={mapOptionLabel(option)}
							class="min-w-[10rem]"
						/>
					{/if}
				</div>
			{/if}
		{/each}
	{/if}
</div>
