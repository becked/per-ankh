<script lang="ts">
	// Head-to-head-by-type module, ported from owglick's H2H card. Every unit
	// type is a center-split diverging-bar row (player A grows left, B grows
	// right), grouped: types both built (shared) first, then A-only, then
	// B-only — with the absent side left blank. Used on the Military tab for the
	// Ending Army / Military Built comparisons. A 1v1 framing; the caller gates
	// it to two players.
	import SpriteIcon from "./SpriteIcon.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import { toRgba } from "$lib/utils/color";

	export type BuildItem = { unitType: string; count: number };

	let {
		title,
		sub,
		a,
		b,
		aLabel,
		bLabel,
		ca,
		cb,
	}: {
		title: string;
		sub?: string;
		a: BuildItem[];
		b: BuildItem[];
		aLabel: string;
		bLabel: string;
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
		group: "shared" | "a" | "b";
	};
	// Shared types (both > 0) sorted by combined count, then each side's
	// exclusives sorted by their own count. Exclusive rows carry a 0 for the
	// side that never built the type.
	const rows = $derived<Row[]>([
		...[...new Set([...aM.keys(), ...bM.keys()])]
			.filter((t) => aM.has(t) && bM.has(t))
			.map((t) => ({
				unitType: t,
				ca: aM.get(t)!,
				cb: bM.get(t)!,
				group: "shared" as const,
			}))
			.sort((p, q) => q.ca + q.cb - (p.ca + p.cb)),
		...[...aM]
			.filter(([t]) => !bM.has(t))
			.map(([unitType, count]) => ({
				unitType,
				ca: count,
				cb: 0,
				group: "a" as const,
			}))
			.sort((p, q) => q.ca - p.ca),
		...[...bM]
			.filter(([t]) => !aM.has(t))
			.map(([unitType, count]) => ({
				unitType,
				ca: 0,
				cb: count,
				group: "b" as const,
			}))
			.sort((p, q) => q.cb - p.cb),
	]);
	// Bar scale: longest single-side count across all rows.
	const max = $derived(Math.max(1, ...rows.map((r) => Math.max(r.ca, r.cb))));
</script>

<div
	class="flex flex-col overflow-hidden rounded-md border border-border-subtle bg-surface-sunken"
>
	<div
		class="flex items-center justify-between gap-2 border-b border-border-subtle bg-surface-deep px-2.5 py-1.5"
	>
		<div
			class="truncate text-[10px] font-bold uppercase tracking-wider text-tan"
		>
			{title}{#if sub}<span class="font-medium text-muted"> · {sub}</span>{/if}
		</div>
		<div class="flex flex-none gap-2.5 text-[10px] font-semibold">
			<span style="color:{ca}">{aLabel}</span>
			<span style="color:{cb}">{bLabel}</span>
		</div>
	</div>

	{#if rows.length > 0}
		<div>
			{#each rows as r, i (r.unitType)}
				{@const groupBreak = i > 0 && rows[i - 1].group !== r.group}
				<div
					class="grid items-center gap-2 px-2.5 py-0.5 {groupBreak
						? 'border-t border-border-subtle'
						: ''}"
					style="grid-template-columns: 110px 1fr; {i % 2
						? 'background:rgb(var(--color-surface-deep) / 0.4)'
						: ''}"
				>
					<div class="flex min-w-0 items-center gap-1.5">
						<SpriteIcon category="units" value={r.unitType} size={14} />
						<span class="truncate text-[11px] text-bright"
							>{formatEnum(r.unitType, "UNIT_")}</span
						>
					</div>
					<div class="flex items-center">
						<span
							class="w-5 flex-none text-center font-mono text-[11px]"
							style="color:{ca};opacity:{r.ca === 0
								? 0
								: r.ca >= r.cb
									? 1
									: 0.5};font-weight:{r.ca > r.cb ? 700 : 500}"
							>{r.ca || ""}</span
						>
						<div class="flex flex-1 justify-end">
							{#if r.ca > 0}
								<div
									class="h-[11px] rounded-l-[3px]"
									style="width:{(r.ca / max) *
										100}%;background:linear-gradient(90deg,{toRgba(
										ca,
										0.19,
									)},{ca})"
								></div>
							{/if}
						</div>
						<div class="mx-1.5 h-3.5 w-px bg-border-subtle"></div>
						<div class="flex flex-1">
							{#if r.cb > 0}
								<div
									class="h-[11px] rounded-r-[3px]"
									style="width:{(r.cb / max) *
										100}%;background:linear-gradient(90deg,{cb},{toRgba(
										cb,
										0.19,
									)})"
								></div>
							{/if}
						</div>
						<span
							class="w-5 flex-none text-center font-mono text-[11px]"
							style="color:{cb};opacity:{r.cb === 0
								? 0
								: r.cb >= r.ca
									? 1
									: 0.5};font-weight:{r.cb > r.ca ? 700 : 500}"
							>{r.cb || ""}</span
						>
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="px-2.5 py-3 text-center text-[10px] text-muted">none built</div>
	{/if}
</div>
