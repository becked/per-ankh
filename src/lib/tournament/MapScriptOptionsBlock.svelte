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

	let status = $state<
		| { kind: "idle" }
		| { kind: "saving" }
		| { kind: "saved" }
		| { kind: "err"; message: string }
	>({ kind: "idle" });

	const scriptOptions = $derived(optionsForScript(script));

	async function commit(next: MapScriptOptions) {
		status = { kind: "saving" };
		try {
			await cloudApi.patchTournament(tournament.tournament_id, {
				map_script_options: next,
			});
			await invalidateAll();
			status = { kind: "saved" };
		} catch (err) {
			let message = "Save failed";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			status = { kind: "err", message };
			// Roll back to server state.
			working = $state.snapshot(tournament.map_script_options);
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

<style>
	.themed-checkbox {
		appearance: none;
		width: 16px;
		height: 16px;
		border: 2px solid var(--color-tan);
		border-radius: 3px;
		background: transparent;
		cursor: pointer;
		position: relative;
		flex-shrink: 0;
		transition:
			background 0.15s ease,
			border-color 0.15s ease;
	}
	.themed-checkbox:checked {
		background: var(--color-orange);
		border-color: var(--color-orange);
	}
	.themed-checkbox:checked::after {
		content: "";
		position: absolute;
		left: 3px;
		top: -1px;
		width: 5px;
		height: 10px;
		border: solid #1a1a1a;
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
	}
	.themed-checkbox:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.themed-checkbox:not(:disabled):hover {
		border-color: var(--color-orange);
	}
</style>

<div class="flex flex-col gap-1.5">
	{#if scriptOptions.length === 0}
		<p class="text-xs text-tan opacity-60">No options for this script.</p>
	{:else}
		{#each scriptOptions as option (option)}
			{@const def = optionDef(option)}
			{#if def}
				<label class="flex items-center justify-between gap-2 text-xs text-tan">
					<span class="opacity-80">{mapOptionLabel(option)}</span>
					{#if def.kind === "toggle"}
						<input
							type="checkbox"
							checked={currentValue(option) === true}
							disabled={status.kind === "saving"}
							onchange={(e) =>
								setOption(option, (e.target as HTMLInputElement).checked)}
							class="themed-checkbox"
						/>
					{:else}
						<select
							value={currentValue(option)}
							disabled={status.kind === "saving"}
							onchange={(e) =>
								setOption(option, (e.target as HTMLSelectElement).value)}
							class="min-w-[10rem] rounded border border-black bg-[#2a2622] p-1 text-xs text-tan disabled:opacity-50"
						>
							{#each def.choices as choice (choice.value)}
								<option value={choice.value}>{choice.label}</option>
							{/each}
						</select>
					{/if}
				</label>
			{/if}
		{/each}
		{#if status.kind === "saving"}
			<span class="self-end text-[10px] text-tan opacity-60">Saving…</span>
		{:else if status.kind === "saved"}
			<span class="self-end text-[10px] text-orange opacity-80">Saved</span>
		{:else if status.kind === "err"}
			<span class="self-end text-[10px] text-red-400">{status.message}</span>
		{/if}
	{/if}
</div>
