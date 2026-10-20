<script lang="ts">
	// Build-by-type module, ported from owglick's H2H card. One row per subject,
	// same chrome throughout, in either of two modes:
	//
	//   duel   — `b`/`cb` passed. The row is a center-split diverging bar, A
	//            growing left and B growing right, the absent side left blank.
	//   ledger — `b` omitted. One bar per row, anchored left and growing right,
	//            with the count trailing it. What a game that isn't a duel gets.
	//
	// Used on the Military tab for the Ending Army / Military Built comparisons,
	// on the Economy tab for improvements, worker-turns and projects, and on the
	// Specialists tab for rural / urban specialists — hence the icon category
	// and label being the caller's to choose.
	import SpriteIcon from "./SpriteIcon.svelte";
	import { unitName } from "$lib/utils/formatting";
	import type { BuildItem, SpriteCategory } from "./helpers";

	let {
		title,
		statA,
		statB,
		a,
		b,
		ca,
		cb,
		keys,
		max,
		labelWidth = "110px",
		iconCategory = "units",
		labelOf = unitName,
		showDiff = false,
	}: {
		// Panel heading. With neither a title nor a stat pair the header bar
		// collapses rather than drawing an empty strip.
		title?: string;
		// Reads "statA v statB", so both or neither. Duel only.
		statA?: string;
		statB?: string;
		a: BuildItem[];
		// The opposing side, and its colour — a pair, like statA/statB. Omitted
		// puts the panel in ledger mode.
		b?: BuildItem[];
		ca: string;
		cb?: string;
		// Optional fixed row order. When the caller renders several panels that
		// should line up (Military Built vs Ending Army, or one ledger per
		// nation), it passes the shared union of keys so every panel draws the
		// same rows in the same order — a type absent from this panel renders as
		// a blank placeholder row. Omitted, the panel derives its own union.
		keys?: string[];
		// The count a full-width bar stands for. Defaults to this panel's own
		// longest row; pass a shared value when panels sit side by side and a
		// bar length has to mean the same thing in each of them.
		max?: number;
		// Width of the label column, including the icon slot and its gap. The
		// label truncates at this width, so a caller whose names run long past
		// the 110px the unit and improvement panels want (projects: "Codex Of
		// Highland Wisdom") has to widen it. `ch` units resolve against the row's
		// own 11px, so a caller can size this off its longest label directly.
		labelWidth?: string;
		// The sprite manifest rows draw their icon from. The slot keeps its fixed
		// width whether or not a key resolves to art, so a row that ships no
		// sprite still lines its label up with one that does.
		iconCategory?: SpriteCategory;
		// Row label. Defaults to the unit case — the only one of the four
		// subjects whose name needs no argument — so the Military tab's panels
		// name a unit the way the rest of the app does; the other callers pass
		// their own baked-name wrapper.
		// eslint-disable-next-line no-unused-vars -- callback type signature
		labelOf?: (key: string) => string;
		// Trailing ±N column: how far ahead the leading side is on that row. Level
		// rows stay blank, so the column reads as a list of the gaps. Duel only —
		// one side has no gap to report.
		showDiff?: boolean;
	} = $props();

	// One side only: bars anchor left instead of splitting about a center.
	const solo = $derived(b == null);

	function byType(items: BuildItem[]): Map<string, number> {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const m = new Map<string, number>();
		for (const it of items) m.set(it.key, (m.get(it.key) ?? 0) + it.count);
		return m;
	}
	const aM = $derived(byType(a));
	const bM = $derived(byType(b ?? []));

	type Row = {
		key: string;
		ca: number;
		cb: number;
	};
	// One row per key. A side that has none of a key carries a 0 and renders a
	// blank bar/count on its half. Rows come from the caller's shared `keys`
	// order when given (so panels line up); otherwise from this panel's own
	// union of both sides, alphabetically by display name.
	const rows = $derived<Row[]>(
		(
			keys ??
			[...new Set([...aM.keys(), ...bM.keys()])].sort((p, q) =>
				labelOf(p).localeCompare(labelOf(q)),
			)
		).map((t) => ({
			key: t,
			ca: aM.get(t) ?? 0,
			cb: bM.get(t) ?? 0,
		})),
	);
	// Bar scale: the caller's shared value when it gave one, otherwise the
	// longest single-side count across this panel's own rows.
	const scale = $derived(
		Math.max(1, max ?? Math.max(...rows.map((r) => Math.max(r.ca, r.cb)), 0)),
	);
	// Per-side totals, shown in a footer row aligned under the count columns.
	const totalA = $derived([...aM.values()].reduce((t, n) => t + n, 0));
	const totalB = $derived([...bM.values()].reduce((t, n) => t + n, 0));
</script>

<div
	class="flex flex-col overflow-hidden rounded-md border border-border-subtle bg-surface-sunken"
>
	{#if title != null || (statA != null && statB != null)}
		<div class="flex items-start justify-between gap-2 px-2.5 py-1.5">
			{#if title != null}
				<div class="truncate text-[10px] font-bold text-tan">{title}</div>
			{/if}
			{#if statA != null && statB != null}
				<!-- ml-auto keeps the stat pair on the right edge when the caller
				     titles the panel from outside and passes no `title` — with a
				     title present justify-between already put it there. -->
				<div
					class="ml-auto flex flex-none items-center gap-1 text-[10px] font-semibold text-muted"
				>
					<span class="font-mono" style="color:{ca}">{statA}</span>
					<span class="text-white">v</span>
					<span class="font-mono" style="color:{cb}">{statB}</span>
					<SpriteIcon category="yields" value="YIELD_TRAINING" size={12} />
				</div>
			{/if}
		</div>
	{/if}

	{#if rows.length > 0}
		<div>
			{#each rows as r (r.key)}
				<!-- text-[11px] is what every cell here already sets for itself; it
				     sits on the grid so a `ch`-sized labelWidth resolves against the
				     row's own font rather than the inherited page one. -->
				<div
					class="grid items-center gap-2 px-2.5 py-0.5 text-[11px]"
					style="grid-template-columns: {labelWidth} 1fr;"
				>
					<div class="flex min-w-0 items-center gap-1.5">
						<span class="flex w-3.5 flex-none">
							<SpriteIcon category={iconCategory} value={r.key} size={14} />
						</span>
						<span class="truncate text-[11px] text-bright"
							>{labelOf(r.key)}</span
						>
					</div>
					<div class="flex items-center">
						{#if solo}
							<div class="flex flex-1">
								{#if r.ca > 0}
									<div
										class="h-[11px] rounded-r-[3px]"
										style="width:{(r.ca / scale) * 100}%;background:{ca}"
									></div>
								{/if}
							</div>
							<div class="mx-0.5"></div>
							<span
								class="w-5 flex-none text-center font-mono text-[11px] text-white"
								>{r.ca || ""}</span
							>
						{:else}
							<span
								class="w-5 flex-none text-center font-mono text-[11px] text-white"
								>{r.ca || ""}</span
							>
							<div class="flex flex-1 justify-end">
								{#if r.ca > 0}
									<div
										class="h-[11px] rounded-l-[3px]"
										style="width:{(r.ca / scale) * 100}%;background:{ca}"
									></div>
								{/if}
							</div>
							<div class="mx-0.5"></div>
							<div class="flex flex-1">
								{#if r.cb > 0}
									<div
										class="h-[11px] rounded-r-[3px]"
										style="width:{(r.cb / scale) * 100}%;background:{cb}"
									></div>
								{/if}
							</div>
							<span
								class="w-5 flex-none text-center font-mono text-[11px] text-white"
								>{r.cb || ""}</span
							>
							{#if showDiff}
								<span
									class="w-8 flex-none text-right font-mono text-[10px]"
									style="color:{r.ca > r.cb ? ca : cb}"
								>
									{r.ca === r.cb ? "" : `+${Math.abs(r.ca - r.cb)}`}
								</span>
							{/if}
						{/if}
					</div>
				</div>
			{/each}
			<!-- Totals: per-side sums aligned under the count columns. -->
			<div
				class="grid items-center gap-2 px-2.5 py-1 text-[11px]"
				style="grid-template-columns: {labelWidth} 1fr;"
			>
				<div class="text-[10px] font-semibold text-muted">Total</div>
				<div class="flex items-center">
					{#if solo}
						<div class="flex flex-1"></div>
						<div class="mx-0.5"></div>
						<span
							class="w-5 flex-none text-center font-mono text-[10px]"
							style="color:{ca}">{totalA}</span
						>
					{:else}
						<span
							class="w-5 flex-none text-center font-mono text-[10px]"
							style="color:{ca}">{totalA}</span
						>
						<div class="flex flex-1"></div>
						<div class="mx-0.5"></div>
						<div class="flex flex-1"></div>
						<span
							class="w-5 flex-none text-center font-mono text-[10px]"
							style="color:{cb}">{totalB}</span
						>
						{#if showDiff}
							<span
								class="w-8 flex-none text-right font-mono text-[10px] font-bold"
								style="color:{totalA > totalB ? ca : cb}"
							>
								{totalA === totalB ? "" : `+${Math.abs(totalA - totalB)}`}
							</span>
						{/if}
					{/if}
				</div>
			</div>
		</div>
	{:else}
		<div class="px-2.5 py-3 text-center text-[10px] text-muted">none built</div>
	{/if}
</div>
