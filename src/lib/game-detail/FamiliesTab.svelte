<script lang="ts">
	// Families tab — the political system, and its price.
	//
	// A family's opinion of its player applies an EffectCity to every city that
	// family holds, and five of the six bands move upkeep: furious costs half as
	// much again, friendly a fifth less. So the three panels here read as one
	// argument — the opinion over time, how much of the game was spent in each
	// band and what that averaged out to, and the share of the workforce each
	// family's territory absorbed.
	import type { ChartOption } from "$lib/echarts";
	import type { CityStatistics } from "$lib/types/CityStatistics";
	import type { ImprovementData } from "$lib/types/ImprovementData";
	import type {
		FamilyInfo,
		FamilyOpinionEntry,
		UnitInfo,
	} from "$lib/parser/types";
	import { FAMILY_OPINION_BANDS } from "$lib/generated/family-opinion";
	import { FAMILY_COLORS } from "$lib/generated/family-colors";
	import { CHART_THEME, getChartColor } from "$lib/config";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import {
		TOOLTIP_BORDER,
		TOOLTIP_MUTED,
		TOOLTIP_SURFACE,
		TOOLTIP_TEXT,
	} from "./EventRail.svelte";
	import { playerEconomies } from "./economy";
	import { familyOpinionSeries, opinionBandTallies } from "./families";
	import {
		type DetailPlayer,
		getSpritePath,
		orderPlayersUploaderFirst,
	} from "./helpers";

	let {
		players,
		improvementData,
		cityStatistics,
		families = [],
		familyOpinionHistory = [],
		units = [],
		totalTurns,
		userNation = null,
	}: {
		players: DetailPlayer[];
		improvementData: ImprovementData;
		cityStatistics: CityStatistics;
		// The family roster, which names every family's class.
		families?: FamilyInfo[];
		// Per-turn opinion. Defaults to [] for legacy callers (frozen web/
		// viewer), which empties the tab rather than breaking it.
		familyOpinionHistory?: FamilyOpinionEntry[];
		units?: UnitInfo[];
		totalTurns: number;
		userNation?: string | null;
	} = $props();

	const orderedPlayers = $derived(
		orderPlayersUploaderFirst(players, userNation),
	);

	const opinions = $derived(
		familyOpinionSeries(familyOpinionHistory, orderedPlayers, totalTurns),
	);

	function pct(value: number): string {
		return `${Math.round(value * 100)}%`;
	}

	// ─── Crests ───────────────────────────────────────────────────────
	// Per-family crest art ships for only a handful of families, so a family
	// falls back to its archetype crest — the same fallback the cities table's
	// Family column uses. The roster is the source: it names every family in
	// the game, including one holding no city at the final turn, which the
	// cities alone would leave crestless. Cities still fill in for blobs that
	// predate the roster (the legacy share viewer passes none).
	const familyClasses = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const out = new Map<string, string>();
		for (const city of cityStatistics.cities) {
			if (city.family != null && city.family_class != null) {
				out.set(city.family, city.family_class);
			}
		}
		for (const family of families) {
			out.set(family.family_name, family.family_class);
		}
		return out;
	});

	function nationCrest(nation: string | null): string | null {
		return nation != null ? getSpritePath("crests", nation) : null;
	}

	function familyCrest(family: string): string | null {
		const own = getSpritePath("crests", family);
		if (own != null) return own;
		return archetypeCrest(familyClasses.get(family) ?? null);
	}

	function archetypeCrest(familyClass: string | null): string | null {
		return familyClass != null
			? getSpritePath(
					"crests",
					familyClass.replace("FAMILYCLASS_", "ARCHETYPE_"),
				)
			: null;
	}

	// A rich style that draws one crest inline in a label. Keyed per row rather
	// than per style, since every row carries a different image.
	function crestStyle(url: string, size: number): object {
		return { height: size, width: size, backgroundColor: { image: url } };
	}

	// Category-axis labels sit flush against the canvas edge, so the grid's
	// left inset and the label's margin are the same number — this one. Wide
	// enough for a crest plus a mirror-match label ("Assyria (name)").
	const LABEL_GUTTER = 160;

	// One box for every crest in an axis label, whichever kind it is.
	const CREST_SIZE = 16;
	const TITLE_CREST_SIZE = 22;

	// ─── Opinion over time ────────────────────────────────────────────
	// One chart per nation rather than one with everybody on it: six lines in
	// two colours is unreadable, and the comparison that matters is between a
	// nation's own families, not across nations. Within a chart the families
	// get distinct colours from the shared series palette; the nation is named
	// and crested in the title, so its colour doesn't have to carry that.
	function opinionChartFor(player: DetailPlayer): ChartOption | null {
		const mine = opinions.filter((s) => s.playerId === player.playerId);
		if (mine.length === 0) return null;
		const crest = nationCrest(player.nation);
		return {
			...CHART_THEME,
			title: {
				...CHART_THEME.title,
				text: `${crest != null ? "{crest|} " : ""}${player.label} — family opinion`,
				textStyle: {
					...CHART_THEME.title.textStyle,
					// Sized to the title text rather than to the axis crests.
					...(crest != null
						? { rich: { crest: crestStyle(crest, TITLE_CREST_SIZE) } }
						: {}),
				},
			},
			legend: {
				show: true,
				bottom: 0,
				textStyle: { color: "#FFFFFF", fontSize: 11 },
			},
			tooltip: {
				trigger: "axis",
				backgroundColor: TOOLTIP_SURFACE,
				borderColor: TOOLTIP_BORDER,
				textStyle: { color: TOOLTIP_TEXT },
			},
			grid: { left: 56, right: 32, top: 48, bottom: 64 },
			xAxis: {
				type: "value",
				name: "Turn",
				nameLocation: "middle",
				nameGap: 26,
				min: 0,
				max: totalTurns,
				minInterval: 1,
				splitLine: { show: false },
			},
			yAxis: {
				type: "value",
				name: "Opinion",
				nameLocation: "middle",
				nameGap: 38,
			},
			series: mine.map((s, i) => {
				// The game's own colour for the family (unique per family ×
				// nation, baked from the family palette); indexed fallback for
				// a family the bake doesn't know (mods).
				const color = FAMILY_COLORS[s.family] ?? getChartColor(i);
				return {
					name: formatEnum(s.family, "FAMILY_"),
					type: "line" as const,
					data: s.points,
					// No symbol at all rather than one that's merely hidden on the
					// plot: the legend draws the series symbol too, and a marker
					// punched through the middle of each swatch reads as noise when
					// the colour of the line is the whole key.
					symbol: "none" as const,
					lineStyle: { color, width: 2 },
					itemStyle: { color },
				};
			}),
		} as ChartOption;
	}

	const opinionCharts = $derived(
		orderedPlayers
			.map((player) => ({ player, option: opinionChartFor(player) }))
			.filter(
				(c): c is { player: DetailPlayer; option: ChartOption } =>
					c.option != null,
			),
	);

	// ─── Turns by band ────────────────────────────────────────────────
	// Semantic scale, so these are literal colours rather than series colours:
	// the bands mean the same thing in every game, and nation colour is spent
	// on the axis labels and the lines above.
	const BAND_COLORS: Record<string, string> = {
		OPINIONFAMILY_FURIOUS: "#8c2f2a",
		OPINIONFAMILY_ANGRY: "#b4524a",
		OPINIONFAMILY_UPSET: "#c98a4b",
		OPINIONFAMILY_CAUTIOUS: "#6b6459",
		OPINIONFAMILY_PLEASED: "#9aa871",
		OPINIONFAMILY_FRIENDLY: "#6f9e5a",
	};

	const bandLabel = (type: string): string =>
		formatEnum(type, "OPINIONFAMILY_");

	const bandTallies = $derived(opinionBandTallies(opinions, orderedPlayers));

	// The rows the chart actually draws — the same list the panel is sized
	// from, so the two can't disagree on the row count.
	const bandRows = $derived(bandTallies.filter((t) => t.familyTurns > 0));

	const bandChartOption = $derived.by<ChartOption | null>(() => {
		if (bandRows.length === 0) return null;
		// Reversed so the first nation sits at the top of a category axis, with
		// its own families directly beneath it.
		const ordered = [...bandRows].reverse();
		const upkeepLabel = (value: number) =>
			`${value > 0 ? "+" : ""}${value.toFixed(1)}% upkeep`;
		// A row reads left to right: the indent that puts a family under its
		// nation, its crest, then the name. A nation heading stays in the axis
		// white; each family's name takes the game's own family colour (the
		// same one its opinion line uses above), falling back to the player
		// colour for a family the bake doesn't know (mods).
		const rich: Record<string, object> = {
			// An empty fragment reserving its width, the same mechanism that
			// draws the crests. The indent can't ride on the crest's own padding:
			// ECharts paints a fragment's background across its padding, so
			// padding there stretches the image instead of moving it.
			indent: { width: 14 },
			nation: { fontWeight: "bold", fontSize: 12 },
		};
		ordered.forEach((t, i) => {
			const url =
				t.family == null ? nationCrest(t.player.nation) : familyCrest(t.family);
			if (url != null) rich[`crest${i}`] = crestStyle(url, CREST_SIZE);
			if (t.family != null) {
				rich[`family${i}`] = {
					color: FAMILY_COLORS[t.family] ?? t.player.color,
					fontSize: 11,
				};
			}
		});
		const styleOf = (t: (typeof ordered)[number], i: number) => {
			const crest = rich[`crest${i}`] != null ? `{crest${i}|} ` : "";
			if (t.family == null) return `${crest}{nation|${t.player.label}}`;
			const name = formatEnum(t.family, "FAMILY_");
			return `{indent|}${crest}{family${i}|${name}}`;
		};
		return {
			...CHART_THEME,
			title: { ...CHART_THEME.title, text: "Turns by family opinion" },
			legend: {
				show: true,
				bottom: 0,
				textStyle: { color: "#FFFFFF", fontSize: 11 },
			},
			tooltip: {
				trigger: "axis",
				axisPointer: { type: "shadow" },
				backgroundColor: TOOLTIP_SURFACE,
				borderColor: TOOLTIP_BORDER,
				textStyle: { color: TOOLTIP_TEXT },
				formatter: (params: unknown) => {
					const arr = params as { dataIndex: number }[];
					const row = ordered[arr[0]?.dataIndex ?? 0];
					if (!row) return "";
					const lines = FAMILY_OPINION_BANDS.filter(
						(b) => (row.counts.get(b.type) ?? 0) > 0,
					).map((b) => {
						const n = row.counts.get(b.type) ?? 0;
						const sign = b.maintenanceModifier > 0 ? "+" : "";
						const effect =
							b.maintenanceModifier === 0
								? "no upkeep change"
								: `${sign}${b.maintenanceModifier}% upkeep`;
						return (
							`<div><span style="color:${BAND_COLORS[b.type]}">■</span> ` +
							`${bandLabel(b.type)} <b>${n}</b> ` +
							`<span style="color:${TOOLTIP_MUTED}">(${pct(n / row.familyTurns)}, ${effect})</span></div>`
						);
					});
					const heading =
						row.family == null
							? `${row.player.label} — all families`
							: `${row.player.label} · ${formatEnum(row.family, "FAMILY_")}`;
					// A family only exists from the turn its first city is founded, so
					// a short bar can mean a late arrival rather than a lost family.
					const since =
						row.firstTurn != null
							? `<div style="color:${TOOLTIP_MUTED};font-size:11px">` +
								`${row.family == null ? "First family from" : "In play from"} turn ${row.firstTurn}</div>`
							: "";
					return (
						`<div style="font-weight:700;color:${row.player.color}">${heading}</div>${since}` +
						lines.join("") +
						`<div style="margin-top:4px;color:${TOOLTIP_MUTED}">` +
						`Across ${row.familyTurns} turns: ` +
						`<b style="color:${TOOLTIP_TEXT}">${upkeepLabel(row.avgMaintenanceModifier)}</b></div>`
					);
				},
			},
			// The right gutter holds the upkeep label clear of the axis end line.
			grid: { left: LABEL_GUTTER, right: 150, top: 48, bottom: 44 },
			xAxis: { type: "value", name: "" },
			yAxis: {
				type: "category",
				data: ordered.map(styleOf),
				axisLabel: {
					rich,
					interval: 0,
					align: "left",
					margin: LABEL_GUTTER,
				},
			},
			series: FAMILY_OPINION_BANDS.map((band, i) => ({
				name: bandLabel(band.type),
				type: "bar" as const,
				stack: "bands",
				data: ordered.map((t) => t.counts.get(band.type) ?? 0),
				itemStyle: { color: BAND_COLORS[band.type] },
				// The average rides off the end of the last segment, so each bar
				// carries its own cost without a second chart.
				...(i === FAMILY_OPINION_BANDS.length - 1
					? {
							label: {
								show: true,
								position: "right" as const,
								distance: 8,
								color: CHART_THEME.textStyle.color,
								fontSize: 11,
								formatter: (p: { dataIndex: number }) =>
									upkeepLabel(
										ordered[p.dataIndex]?.avgMaintenanceModifier ?? 0,
									),
							},
						}
					: {}),
			})),
		} as ChartOption;
	});

	// ─── Worker-turns by family ───────────────────────────────────────
	// How much of each workforce went into each family's territory — the
	// economic footprint behind the politics above.
	const economies = $derived(
		playerEconomies(
			orderedPlayers,
			improvementData.improvements,
			cityStatistics.cities,
			units,
		),
	);

	const familyWorkRows = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const totals = new Map<string, number>();
		for (const eco of economies) {
			for (const f of eco.byFamily) {
				const key = f.familyClass ?? "";
				totals.set(key, (totals.get(key) ?? 0) + f.turns);
			}
		}
		// Ascending so the biggest sits at the top — ECharts lays a category axis
		// out bottom-up.
		return [...totals.entries()]
			.sort((a, b) => a[1] - b[1])
			.map(([key]) => ({
				key,
				// Work outside any city's territory is a real bucket, not a gap.
				label: key === "" ? "Outside cities" : formatEnum(key, "FAMILYCLASS_"),
				values: economies.map(
					(eco) =>
						eco.byFamily.find((f) => (f.familyClass ?? "") === key)?.turns ?? 0,
				),
			}));
	});

	const familyWorkOption = $derived.by<ChartOption>(() => {
		// These rows are family classes rather than named families, so they take
		// the archetype crest directly — the same art the per-family rows above
		// fall back to.
		const rich: Record<string, object> = { row: { fontSize: 12 } };
		familyWorkRows.forEach((r, i) => {
			const url = r.key === "" ? null : archetypeCrest(r.key);
			if (url != null) rich[`crest${i}`] = crestStyle(url, CREST_SIZE);
		});
		return {
			...CHART_THEME,
			title: { ...CHART_THEME.title, text: "Worker-turns by family" },
			legend: {
				show: orderedPlayers.length > 1,
				top: 4,
				// Clear of ChartContainer's fullscreen button in the corner.
				right: 44,
				textStyle: { color: "#FFFFFF" },
			},
			tooltip: { ...CHART_THEME.tooltip, axisPointer: { type: "shadow" } },
			grid: { left: LABEL_GUTTER, right: 24, top: 56, bottom: 44 },
			xAxis: {
				type: "value",
				name: "Worker-turns",
				nameLocation: "middle",
				nameGap: 28,
			},
			yAxis: {
				type: "category",
				data: familyWorkRows.map((r, i) =>
					rich[`crest${i}`] != null
						? `{crest${i}|} {row|${r.label}}`
						: `{row|${r.label}}`,
				),
				axisLabel: {
					rich,
					interval: 0,
					align: "left",
					margin: LABEL_GUTTER,
				},
			},
			series: orderedPlayers.map((p, i) => ({
				name: p.label,
				type: "bar" as const,
				data: familyWorkRows.map((r) => r.values[i] ?? 0),
				itemStyle: { color: p.color },
			})),
		} as ChartOption;
	});

	// One row pitch for both bar charts, so a row is the same height whichever
	// panel it sits in. `chrome` is the fixed space a chart needs around its
	// rows — title and axis, plus the band chart's bottom legend.
	const barHeight = (rows: number, chrome = 110): string =>
		`${Math.max(rows, 1) * 30 + chrome}px`;
</script>

{#if opinionCharts.length === 0 && familyWorkRows.length === 0}
	<p class="p-8 text-center italic text-tan">No family data in this save</p>
{:else}
	{#if opinionCharts.length > 0}
		<div class="mb-4 grid items-start gap-4 lg:grid-cols-2">
			{#each opinionCharts as chart (chart.player.playerId)}
				<div
					class="rounded-lg p-4"
					style="background-color: rgb(var(--color-surface));"
				>
					<ChartContainer
						option={chart.option}
						height="320px"
						title="{chart.player.label} — family opinion"
					/>
				</div>
			{/each}
		</div>
	{/if}

	{#if bandChartOption}
		<div
			class="mb-4 rounded-lg p-4"
			style="background-color: rgb(var(--color-surface));"
		>
			<ChartContainer
				option={bandChartOption}
				height={barHeight(bandRows.length, 130)}
				title="Turns by family opinion"
			/>
		</div>
	{/if}

	{#if familyWorkRows.length > 0}
		<div
			class="mb-4 rounded-lg p-4"
			style="background-color: rgb(var(--color-surface));"
		>
			<ChartContainer
				option={familyWorkOption}
				height={barHeight(familyWorkRows.length)}
				title="Worker-turns by family"
			/>
		</div>
	{/if}
{/if}
