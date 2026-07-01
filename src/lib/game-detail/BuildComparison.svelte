<script lang="ts">
	// Head-to-head-by-type module, ported from owglick's H2H card. Every unit
	// type is a center-split diverging-bar row (player A grows left, B grows
	// right), listed alphabetically by unit type — with the absent side left
	// blank when only one player built a type. Used on the Military tab for the
	// Ending Army / Military Built comparisons. A 1v1 framing; the caller gates
	// it to two players.
	import SpriteIcon from "./SpriteIcon.svelte";
	import { formatEnum } from "$lib/utils/formatting";

	export type BuildItem = { unitType: string; count: number };

	let {
		title,
		statA,
		statB,
		a,
		b,
		ca,
		cb,
	}: {
		title: string;
		statA?: string;
		statB?: string;
		a: BuildItem[];
		b: BuildItem[];
		ca: string;
		cb: string;
	} = $props();

	function byType(items: BuildItem[]): Map<string, number> {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const m = new Map<string, number>();
		for (const it of items)
			m.set(it.unitType, (m.get(it.unitType) ?? 0) + it.count);
		return m;
	}
	const aM = $derived(byType(a));
	const bM = $derived(byType(b));

	type Row = {
		unitType: string;
		ca: number;
		cb: number;
	};
	// One row per unit type either player built (union of both rosters),
	// listed alphabetically by display name. A side that never built a type
	// carries a 0 and renders a blank bar/count on its half.
	const rows = $derived<Row[]>(
		[...new Set([...aM.keys(), ...bM.keys()])]
			.map((t) => ({
				unitType: t,
				ca: aM.get(t) ?? 0,
				cb: bM.get(t) ?? 0,
			}))
			.sort((p, q) =>
				formatEnum(p.unitType, "UNIT_").localeCompare(
					formatEnum(q.unitType, "UNIT_"),
				),
			),
	);
	// Bar scale: longest single-side count across all rows.
	const max = $derived(Math.max(1, ...rows.map((r) => Math.max(r.ca, r.cb))));
	// Per-side unit totals, shown in a footer row aligned under the count columns.
	const totalA = $derived([...aM.values()].reduce((t, n) => t + n, 0));
	const totalB = $derived([...bM.values()].reduce((t, n) => t + n, 0));
</script>

<div
	class="flex flex-col overflow-hidden rounded-md border border-border-subtle bg-surface-sunken"
>
	<div class="flex items-start justify-between gap-2 px-2.5 py-1.5">
		<div class="truncate text-[10px] font-bold text-tan">{title}</div>
		{#if statA != null && statB != null}
			<div
				class="flex flex-none items-center gap-1 text-[10px] font-semibold text-muted"
			>
				<span class="font-mono" style="color:{ca}">{statA}</span>
				<span class="text-white">v</span>
				<span class="font-mono" style="color:{cb}">{statB}</span>
				<SpriteIcon category="yields" value="YIELD_TRAINING" size={12} />
			</div>
		{/if}
	</div>

	{#if rows.length > 0}
		<div>
			{#each rows as r (r.unitType)}
				<div
					class="grid items-center gap-2 px-2.5 py-0.5"
					style="grid-template-columns: 110px 1fr;"
				>
					<div class="flex min-w-0 items-center gap-1.5">
						<span class="flex w-3.5 flex-none">
							<SpriteIcon category="units" value={r.unitType} size={14} />
						</span>
						<span class="truncate text-[11px] text-bright"
							>{formatEnum(r.unitType, "UNIT_")}</span
						>
					</div>
					<div class="flex items-center">
						<span
							class="w-5 flex-none text-center font-mono text-[11px] text-white"
							>{r.ca || ""}</span
						>
						<div class="flex flex-1 justify-end">
							{#if r.ca > 0}
								<div
									class="h-[11px] rounded-l-[3px]"
									style="width:{(r.ca / max) * 100}%;background:{ca}"
								></div>
							{/if}
						</div>
						<div class="mx-1.5 h-3.5 w-px bg-border-subtle"></div>
						<div class="flex flex-1">
							{#if r.cb > 0}
								<div
									class="h-[11px] rounded-r-[3px]"
									style="width:{(r.cb / max) * 100}%;background:{cb}"
								></div>
							{/if}
						</div>
						<span
							class="w-5 flex-none text-center font-mono text-[11px] text-white"
							>{r.cb || ""}</span
						>
					</div>
				</div>
			{/each}
			<!-- Totals: per-side sums aligned under the count columns. -->
			<div
				class="grid items-center gap-2 border-t border-border-subtle px-2.5 py-1"
				style="grid-template-columns: 110px 1fr;"
			>
				<div class="text-[10px] font-semibold text-muted">Total</div>
				<div class="flex items-center">
					<span
						class="w-5 flex-none text-center font-mono text-[11px] font-bold text-white"
						>{totalA}</span
					>
					<div class="flex flex-1"></div>
					<div class="mx-1.5 h-3.5 w-px bg-border-subtle"></div>
					<div class="flex flex-1"></div>
					<span
						class="w-5 flex-none text-center font-mono text-[11px] font-bold text-white"
						>{totalB}</span
					>
				</div>
			</div>
		</div>
	{:else}
		<div class="px-2.5 py-3 text-center text-[10px] text-muted">none built</div>
	{/if}
</div>
