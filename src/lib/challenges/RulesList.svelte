<script lang="ts">
	// The rules of a challenge in words: objectives and criteria.
	// With a `verdict`, each objective and criterion line also carries the
	// scorer's ✓/✗ and what it observed — the same component renders the
	// challenge page (no verdict) and the upload preview (verdict), so the
	// two can't describe a rule differently.
	import { describeCriterion, describeObjective } from "./describe";
	import type { Criterion, Objective, Verdict } from "./types";

	let {
		objectives,
		criteria,
		verdict = null,
	}: {
		objectives: Objective[];
		criteria: Criterion[];
		verdict?: Verdict | null;
	} = $props();
</script>

{#snippet mark(met: boolean)}
	<span
		class="shrink-0 font-bold {met ? 'text-success' : 'text-danger'}"
		aria-label={met ? "Met" : "Not met"}
	>
		{met ? "✓" : "✗"}
	</span>
{/snippet}

<div class="space-y-3 text-sm">
	<div>
		<h3 class="mb-1 text-xs font-bold uppercase tracking-wide text-gray-400">
			Objectives
		</h3>
		<ol class="space-y-1">
			{#each objectives as o, i (i)}
				{@const v = verdict?.objectives[i]}
				<li class="flex items-start gap-2 text-gray-200">
					{#if v}
						{@render mark(v.met)}
					{:else}
						<span class="shrink-0 text-gray-400">{i + 1}.</span>
					{/if}
					<span>
						{describeObjective(o)}
						{#if v}
							<span class="text-xs text-gray-400">— {v.observed}</span>
						{/if}
					</span>
				</li>
			{/each}
		</ol>
	</div>

	{#if criteria.length > 0}
		<div>
			<h3 class="mb-1 text-xs font-bold uppercase tracking-wide text-gray-400">
				Criteria
			</h3>
			<ul class="space-y-1">
				{#each criteria as c, i (c.kind)}
					{@const v = verdict?.criteria[i]}
					<li class="flex items-start gap-2 text-gray-200">
						{#if v}
							{@render mark(v.met)}
						{:else}
							<span class="shrink-0 text-gray-400">•</span>
						{/if}
						<span>
							{describeCriterion(c)}
							{#if v && !v.met}
								<span class="text-xs text-gray-400">— {v.detail}</span>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>
