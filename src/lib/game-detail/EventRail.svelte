<script lang="ts" module>
	import type { DetailPlayer, SpriteCategory } from "./helpers";

	// One marker on the rail: an icon at its event's turn-x with a rich hover
	// tooltip. A null iconValue renders a colored dot instead of a sprite.
	export type RailMarker = {
		turn: number;
		iconCategory: SpriteCategory;
		iconValue: string | null;
		color: string;
		tooltipHtml: string;
	};

	// One row of same-kind markers inside a player's band (e.g. "law", "tech").
	export type RailRow = { kind: string; markers: RailMarker[] };

	// One player's band: up to a few kind-rows, in the order given.
	export type RailGroup = { player: DetailPlayer; rows: RailRow[] };
</script>

<script lang="ts">
	import type { ECharts } from "echarts";
	import SpriteIcon from "./SpriteIcon.svelte";
	import { getSpritePath } from "./helpers";

	// A DOM annotation rail below a game-detail chart: one tinted band per
	// player, one row per event kind, each marker a real <SpriteIcon> at its
	// event's true turn-x. Positions come from the live chart instance via
	// convertToPixel, so the rail tracks the plot on resize with no fixed pixel
	// insets. The parent owns the Chart (and the vertical hover guide over it)
	// and feeds `chart` + `layoutTick` from Chart's onReady/onLayout callbacks.
	let {
		chart,
		layoutTick,
		groups,
		onHighlight,
	}: {
		chart: ECharts | null;
		// Bumped by the parent on every chart re-layout (init / option change /
		// resize) so marker positions refresh.
		layoutTick: number;
		groups: RailGroup[];
		// Fired on marker hover with the hovered event's turn + color (null on
		// leave); the parent drops a vertical guide line on its plot from it.
		// eslint-disable-next-line no-unused-vars -- callback type signature
		onHighlight?: (h: { turn: number; color: string } | null) => void;
	} = $props();

	// Per-marker render sizes (bare icons, no tile). The nation crest reads as
	// the row label at 24; event icons sit at 14 so every marker kind reads at
	// the same weight. Unmapped categories fall back to the default.
	const RAIL_ICON_SIZE_DEFAULT = 16;
	const RAIL_ICON_SIZE: Partial<Record<SpriteCategory, number>> = {
		crests: 24,
		"traits-trimmed": 14,
		laws: 14,
		units: 14,
		techs: 14,
		yields: 14,
	};

	// Divider between the stacked per-event tooltips of a merged marker.
	const TOOLTIP_SEP = `<div style="border-top:1px solid #4a453d;margin:7px 0 6px"></div>`;

	// Merge same-row markers whose resolved centers land within ~a marker width
	// (markers are 14px, centered on their turn) so near-overlapping icons
	// collapse into one — the first marker's icon/turn is kept and the rest are
	// concatenated into its tooltip. This must run on pixel positions, not turn
	// gaps: whether two events overlap depends on the live chart width (a turn gap
	// that's clear on a 40-turn game collides on a 200-turn one), so it recomputes
	// with the layout. Same-turn markers (identical x) are the degenerate case.
	// Input is one kind sorted by turn, so mergeable markers are adjacent.
	const RAIL_MERGE_PX = 16;
	type RailIcon = RailMarker & { left: number | null };
	function mergeByProximity(icons: RailIcon[]): RailIcon[] {
		const out: RailIcon[] = [];
		for (const icon of icons) {
			const last = out[out.length - 1];
			if (
				last &&
				last.left != null &&
				icon.left != null &&
				Math.abs(icon.left - last.left) < RAIL_MERGE_PX
			) {
				last.tooltipHtml += TOOLTIP_SEP + icon.tooltipHtml;
			} else {
				out.push({ ...icon });
			}
		}
		return out;
	}

	// Per-player rows with each marker's plot-pixel x resolved from the live
	// chart; recomputes on every re-layout.
	type RailIconRow = { kind: string; icons: RailIcon[] };
	type RailViewGroup = { player: DetailPlayer; rows: RailIconRow[] };
	const railView = $derived.by<RailViewGroup[]>(() => {
		const c = chart;
		// `layoutTick >= 0` is always true but reads the signal, so positions
		// recompute whenever the chart re-lays-out.
		const ready = c != null && layoutTick >= 0;
		const xPixel = (turn: number): number | null =>
			ready ? (c!.convertToPixel({ xAxisIndex: 0 }, turn) as number) : null;
		return groups.map((g) => ({
			player: g.player,
			rows: g.rows.map((r) => ({
				kind: r.kind,
				icons: mergeByProximity(
					r.markers.map((m) => ({ ...m, left: xPixel(m.turn) })),
				),
			})),
		}));
	});

	// Floating tooltip for the hovered marker.
	let tip = $state<{ html: string; x: number; y: number } | null>(null);

	// Turn-0 x where the inter-kind separators begin, so they don't run back
	// under the nation crest in the y-axis inset. Tracks the live chart.
	const railSepLeft = $derived.by<number | null>(() => {
		const c = chart;
		// Reads layoutTick so it recomputes on every chart re-layout.
		if (!c || layoutTick < 0) return null;
		return c.convertToPixel({ xAxisIndex: 0 }, 0) as number;
	});

	// X pixels of the chart's interior x-axis tick labels (the turn values ECharts
	// labels on the plot). The rail drops a faint vertical rule under each so it
	// reads as a grid aligned to those labels above. ECharts picks these ticks
	// dynamically, so they're read from the live axis model, then mapped through
	// the same convertToPixel the markers use. The first and last ticks (turn 0
	// and the final turn) are dropped so no rule hugs the plot's left/right edges.
	// Reads layoutTick so it recomputes on every chart re-layout.
	const railTickLefts = $derived.by<number[]>(() => {
		const c = chart;
		if (!c || layoutTick < 0) return [];
		// getModel()/axis.scale.getTicks() is ECharts-internal (not in the public
		// typings, hence the cast); guarded so a shape change degrades to no rules
		// rather than throwing.
		const axis = (c as any).getModel?.()?.getComponent?.("xAxis", 0)?.axis;
		const ticks: unknown[] = axis?.scale?.getTicks?.() ?? [];
		const turns = ticks
			.map((t) =>
				typeof t === "object" && t !== null
					? (t as { value: number }).value
					: (t as number),
			)
			.filter((v) => Number.isFinite(v) && v >= 0)
			.sort((a, b) => a - b);
		return turns
			.slice(1, -1)
			.map((v) => c.convertToPixel({ xAxisIndex: 0 }, v) as number);
	});

	function enterEvent(marker: RailMarker, e: MouseEvent) {
		tip = {
			html: marker.tooltipHtml,
			x: Math.min(e.clientX + 14, window.innerWidth - 300),
			y: Math.min(e.clientY + 14, window.innerHeight - 170),
		};
		onHighlight?.({ turn: marker.turn, color: marker.color });
	}
	function leaveEvent() {
		tip = null;
		onHighlight?.(null);
	}
</script>

<div class="mt-1.5 flex flex-col gap-1">
	{#each railView as group (group.player.playerId)}
		<div class="relative rounded bg-blue-gray py-0.5">
			<!-- Faint vertical rules under each chart x-axis label, so the
			     rail reads as a grid aligned to the plot's turn labels above.
			     Same tint/opacity as the inter-kind separators. -->
			{#each railTickLefts as tx, i (i)}
				<div
					class="pointer-events-none absolute inset-y-0 w-px bg-[#2a2623]/50"
					style="left: {tx}px;"
				></div>
			{/each}
			<!-- Nation crest, centered in the left gutter — turn 0 marks the
			     gutter's right edge, so the crest sits under the chart's
			     y-axis inset above. -->
			<div
				class="absolute inset-y-0 left-0 z-20 flex items-center justify-center"
				style="width: {railSepLeft != null ? railSepLeft + 'px' : 'auto'};"
			>
				{#if group.player.nation}
					<SpriteIcon
						category="crests"
						value={group.player.nation}
						size={RAIL_ICON_SIZE.crests ?? RAIL_ICON_SIZE_DEFAULT}
						alt={group.player.label}
					/>
				{:else}
					<span
						class="truncate text-[10px] font-semibold"
						style="color: {group.player.color};">{group.player.label}</span
					>
				{/if}
			</div>
			{#each group.rows as row, ri (row.kind)}
				<!-- One row per event kind; faint rules separate the kinds. -->
				<div class="relative h-6">
					{#if ri > 0 && railSepLeft != null}
						<!-- Faint inter-kind separator; starts at turn 0 so it clears the crest. -->
						<div
							class="pointer-events-none absolute right-0 top-0 h-px bg-[#2a2623]/50"
							style="left: {railSepLeft}px;"
						></div>
					{/if}
					{#each row.icons as icon, i (i)}
						{#if icon.left != null}
							<!-- A marker with no sprite (null iconValue, or a value the
							     manifest doesn't cover) falls back to a colored dot so
							     the event never renders invisible. -->
							{@const v =
								icon.iconValue &&
								getSpritePath(icon.iconCategory, icon.iconValue)
									? icon.iconValue
									: null}
							<div
								class="absolute top-1/2 flex cursor-default items-center"
								style="left: {icon.left}px; transform: translate(-50%, -50%);"
								role="img"
								aria-label={row.kind}
								onmousemove={(e) => enterEvent(icon, e)}
								onmouseleave={leaveEvent}
							>
								{#if v}
									<SpriteIcon
										category={icon.iconCategory}
										value={v}
										size={RAIL_ICON_SIZE[icon.iconCategory] ??
											RAIL_ICON_SIZE_DEFAULT}
									/>
								{:else}
									<span
										class="inline-block h-2.5 w-2.5 rounded-full"
										style="background: {icon.color};"
									></span>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			{/each}
		</div>
	{/each}
</div>

<!-- Floating tooltip for the rail markers. -->
{#if tip}
	<div
		class="pointer-events-none fixed z-50 max-w-[290px] rounded-md border border-border-subtle bg-surface-deep px-2.5 py-2 shadow-xl"
		style="left: {tip.x}px; top: {tip.y}px;"
	>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- internally-built, no user input -->
		{@html tip.html}
	</div>
{/if}
