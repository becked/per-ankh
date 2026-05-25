<script lang="ts">
	import {
		effectiveOptionValue,
		mapOptionLabel,
		optionDef,
		optionsForScript,
	} from "$lib/tournament/map-script-options";
	import Checkbox from "$lib/ui/Checkbox.svelte";
	import Select from "$lib/ui/Select.svelte";

	interface Props {
		// A single map_pool instance's script + options. Controlled: changes are
		// reported via onChange with the full next options object; the parent
		// (TournamentMapsPanel) folds them into the pool and persists.
		script: string;
		options: Record<string, string | boolean>;
		disabled?: boolean;
		// eslint-disable-next-line no-unused-vars -- param name is documentary
		onChange: (next: Record<string, string | boolean>) => void;
	}

	let { script, options, disabled = false, onChange }: Props = $props();

	const scriptOptions = $derived(optionsForScript(script));

	function setOption(option: string, value: string | boolean) {
		onChange({ ...options, [option]: value });
	}

	function currentValue(option: string): string | boolean {
		return effectiveOptionValue(options, option);
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
							{disabled}
							onCheckedChange={(c) => setOption(option, c)}
						/>
					{:else}
						<Select
							value={String(currentValue(option) ?? "")}
							onChange={(v) => v != null && setOption(option, v)}
							options={def.choices}
							{disabled}
							ariaLabel={mapOptionLabel(option)}
							class="min-w-[10rem]"
						/>
					{/if}
				</div>
			{/if}
		{/each}
	{/if}
</div>
