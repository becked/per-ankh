<script lang="ts">
	import type { MapPoolEntry } from "$lib/api-cloud";
	import { mapScriptLabel } from "$lib/tournament/map-scripts";
	import {
		effectiveOptionValue,
		mapOptionChoiceLabel,
		nonDefaultOptions,
	} from "$lib/tournament/map-script-options";

	interface Props {
		mapPool: readonly MapPoolEntry[];
	}

	let { mapPool }: Props = $props();

	// Size and aspect ratio are shown inline in each map's headline
	// (e.g. "Square Continent Duel"), so they're excluded from the
	// per-map list of non-default settings below.
	const HEADLINE_OPTIONS = ["MAPSIZE", "MAPASPECTRATIO"];

	function headline(entry: MapPoolEntry): string {
		const aspect = mapOptionChoiceLabel(
			"MAPASPECTRATIO",
			effectiveOptionValue(entry.options, "MAPASPECTRATIO"),
		);
		const size = mapOptionChoiceLabel(
			"MAPSIZE",
			effectiveOptionValue(entry.options, "MAPSIZE"),
		);
		return `${aspect} ${mapScriptLabel(entry.script)} ${size}`;
	}

	function extras(entry: MapPoolEntry) {
		return nonDefaultOptions(entry.options, entry.script).filter(
			(o) => !HEADLINE_OPTIONS.includes(o.option),
		);
	}
</script>

{#if mapPool.length > 0}
	<section class="mb-6 rounded-lg p-4" style="background-color: #2a2622;">
		<h2 class="mb-3 text-sm font-bold text-tan">Map scripts</h2>
		<ul class="flex flex-col gap-1.5 text-xs text-tan">
			{#each mapPool as entry (entry.id)}
				{@const settings = extras(entry)}
				<li
					class="rounded border border-black bg-[#35302b] px-3 py-2"
					title={entry.script}
				>
					<span class="font-bold">{headline(entry)}</span>
					{#if settings.length > 0}
						<dl
							class="mt-1.5 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5"
						>
							{#each settings as opt (opt.option)}
								<dt class="opacity-70">{opt.label}</dt>
								<dd class="text-orange">{opt.value}</dd>
							{/each}
						</dl>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}
