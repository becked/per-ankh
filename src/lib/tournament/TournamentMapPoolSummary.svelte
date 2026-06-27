<script lang="ts">
	import type { MapPoolEntry } from "$lib/api-cloud";
	import {
		distinguishingOptions,
		labelConsumedOptions,
		mapPoolLabel,
		nonDefaultOptions,
	} from "$lib/tournament/map-script-options";

	interface Props {
		mapPool: readonly MapPoolEntry[];
	}

	let { mapPool }: Props = $props();

	// Options that vary across the pool — drives which variant option the
	// headline label surfaces.
	const distinguishing = $derived(distinguishingOptions(mapPool));

	// Non-default settings the headline label doesn't already show, listed as
	// detail beneath it (e.g. resource density, city sites). Aspect, size,
	// point symmetry, and the distinguishing variant option are excluded since
	// the label covers them.
	function extras(entry: MapPoolEntry) {
		const consumed = labelConsumedOptions(entry, distinguishing);
		return nonDefaultOptions(entry.options, entry.script).filter(
			(o) => !consumed.has(o.option),
		);
	}
</script>

{#if mapPool.length > 0}
	<section
		class="mb-6 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<h2 class="mb-3 text-sm font-bold text-tan">Map scripts</h2>
		<ul class="flex flex-col gap-1.5 text-xs text-tan">
			{#each mapPool as entry (entry.id)}
				{@const settings = extras(entry)}
				<li
					class="rounded border border-black bg-surface-raised px-3 py-2"
					title={entry.script}
				>
					<span class="font-bold">{mapPoolLabel(entry, distinguishing)}</span>
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
