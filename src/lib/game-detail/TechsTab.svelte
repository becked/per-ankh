<script lang="ts">
	import type { TechDiscoveryHistory } from "$lib/types/TechDiscoveryHistory";
	import type { PlayerTech } from "$lib/types/PlayerTech";
	import type { YieldHistory } from "$lib/types/YieldHistory";
	import type { LawAdoptionHistory } from "$lib/types/LawAdoptionHistory";
	import type { PlayerLaw } from "$lib/types/PlayerLaw";
	import type { ImprovementData } from "$lib/types/ImprovementData";
	import type { CityStatistics } from "$lib/types/CityStatistics";
	import type { StoryEvent } from "$lib/types/StoryEvent";
	import type {
		CharacterInfo,
		FamilyInfo,
		MemoryInfo,
	} from "$lib/parser/types";
	import type { EChartsOption, ECharts } from "echarts";
	import Chart from "$lib/Chart.svelte";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import { TECH_NAMES } from "$lib/generated/tech-names";
	import { CHART_THEME, getNationChartColor } from "$lib/config";
	import SpriteIcon from "./SpriteIcon.svelte";
	import EventRail, {
		TOOLTIP_TEXT,
		TOOLTIP_MUTED,
		type RailGroup,
		type RailMarker,
	} from "./EventRail.svelte";
	import TableFilterColumn from "./TableFilterColumn.svelte";
	import NationFilterSelect from "./NationFilterSelect.svelte";
	import TechComparison from "./TechComparison.svelte";
	import { specialistName } from "./specialists";
	import {
		type TableState,
		type DetailPlayer,
		TABLE_FRAME_CLASS,
		TABLE_CLASS,
		TABLE_HEADER_TH_CLASS,
		TABLE_CELL_TD_CLASS,
		ownedByPlayer,
		findByPlayer,
		orderPlayersUploaderFirst,
		toggleSort,
		filledLineStyle,
		getSpritePath,
		improvementDisplayName,
	} from "./helpers";
	import {
		scienceTechMarkers,
		freeTechMarkers,
		sagesSeatFoundedTurn,
		scienceSpikes,
		scienceBreakdown,
		expeditionEvents,
		STEAL_RESEARCH_MEMORY,
		type ScienceTechMarker,
		type FreeTechMarker,
		type ScienceSpike,
		type ScienceBreakdown,
		type NamedCount,
	} from "./science-techs";

	let {
		players,
		techDiscoveryHistory,
		completedTechs,
		allYields,
		lawAdoptionHistory,
		currentLaws,
		improvementData,
		cityStatistics,
		families = [],
		memoryData = [],
		storyEvents = [],
		characters = [],
		gameOptions = null,
		userNation = null,
		chartFilter = $bindable<Record<string, boolean>>({}),
		tableState = $bindable<TableState>({
			search: "",
			sortColumn: "nation",
			sortDirection: "asc",
			filters: [],
		}),
	}: {
		players: DetailPlayer[];
		techDiscoveryHistory: TechDiscoveryHistory[];
		completedTechs: PlayerTech[];
		allYields: YieldHistory[];
		lawAdoptionHistory: LawAdoptionHistory[];
		currentLaws: PlayerLaw[];
		improvementData: ImprovementData;
		cityStatistics: CityStatistics;
		families?: FamilyInfo[];
		memoryData?: MemoryInfo[];
		storyEvents?: StoryEvent[];
		characters?: CharacterInfo[];
		// Set <GameOptions> flags. Null on pre-2.11.0 blobs (and from the frozen
		// web/ viewer) — "unknown", not "none set".
		gameOptions?: Record<string, true> | null;
		userNation?: string | null;
		chartFilter?: Record<string, boolean>;
		tableState?: TableState;
	} = $props();

	// Resolved identity lookup (stable label + color per player), keyed by the
	// player id every per-player array carries. Mirror-match safe.
	const playerById = $derived(new Map(players.map((p) => [p.playerId, p])));

	// Canonical player order: uploader first (shared rule with MilitaryTab).
	const orderedPlayers = $derived(
		orderPlayersUploaderFirst(players, userNation),
	);

	// Tech display name — the baked override, else the generic formatter.
	const techName = (tech: string) =>
		TECH_NAMES[tech] ?? formatEnum(tech, "TECH_");

	// ─── Chart option ─────────────────────────────────────────────────
	const techDiscoveryChartOption = $derived(
		techDiscoveryHistory.length > 0
			? (() => {
					const histories = techDiscoveryHistory;
					const maxTechCount = Math.max(
						...histories.flatMap((player) =>
							player.data.map((d) => d.tech_count),
						),
					);
					const finalTurn = Math.max(
						...histories.flatMap((player) => player.data.map((d) => d.turn)),
					);
					const seriesLabels = histories.map(
						(p) =>
							playerById.get(p.player_id)?.label ??
							formatEnum(p.nation, "NATION_"),
					);

					return {
						...CHART_THEME,
						title: {
							...CHART_THEME.title,
							text: "Tech Discovery Over Time",
						},
						legend: {
							show: false,
							data: seriesLabels,
							selected: chartFilter,
						},
						tooltip: {
							trigger: "axis",
							// Points are sparse (one per discovery), so snap the axis
							// pointer to the nearest event and drive the tooltip off the
							// axis — hovering anywhere works, matching the other charts.
							axisPointer: { snap: true },
							formatter: (params: unknown) => {
								const arr = params as Array<{
									marker: string;
									seriesName: string;
									data: [number, number, string | null];
								}>;
								if (arr.length === 0) return "";
								const turn = arr[0].data[0];
								const rows = arr
									.map((p) => {
										const [, count, tech] = p.data;
										const suffix = tech ? ` — ${techName(tech)}` : "";
										return `${p.marker}${p.seriesName}: <b>${count}</b>${suffix}`;
									})
									.join("<br/>");
								return `Turn ${turn}<br/>${rows}`;
							},
						},
						// No axis-name titles — the title + tooltip carry the meaning,
						// matching the Military Power plot. containLabel reserves room
						// for the tick numbers now that the fixed left/bottom gutters
						// (which the axis names needed) are gone.
						grid: {
							top: 44,
							left: 8,
							right: 20,
							bottom: 24,
							containLabel: true,
						},
						xAxis: {
							type: "value",
							splitLine: { show: false },
							max: finalTurn,
						},
						yAxis: {
							type: "value",
							max: maxTechCount + 2,
						},
						series: histories.map((player, i) => {
							const rp = playerById.get(player.player_id);
							const color = rp?.color ?? getNationChartColor(player.nation, i);
							return {
								name: rp?.label ?? formatEnum(player.nation, "NATION_"),
								type: "line" as const,
								data: player.data.map((d) => [
									d.turn,
									d.tech_count,
									d.tech_name,
								]),
								itemStyle: { color },
								// Milestone markers stay hidden until hover (per the shared
								// look) but still name the discovered tech in the tooltip.
								symbol: (value: [number, number, string | null]) =>
									value[2] ? "circle" : "none",
								symbolSize: 8,
								emphasis: {
									symbolSize: 12,
								},
								...filledLineStyle(color),
							};
						}),
					} as EChartsOption;
				})()
			: null,
	);

	// ─── Science annotation rail ──────────────────────────────────────
	// An <EventRail> under the Tech Discovery chart of science-relevant
	// events per player: key science techs the player researched AND
	// demonstrably used (see science-techs.ts), free-tech turns, and one-off
	// science gains. (Cumulative science itself lives on the Yields tab.)
	// Like the Military rail, the annotated variant renders for two-player
	// matchups; other games get the plain chart.

	// Per-player data slices for the rail (id match, nation fallback — the
	// shared ownedByPlayer/findByPlayer idiom).
	const techsFor = (p: DetailPlayer) =>
		ownedByPlayer(
			completedTechs,
			p,
			(t) => t.player_id,
			(t) => t.nation,
		);
	const namedCounts = (items: NamedCount[]) =>
		items.map((b) => `${b.count}× ${b.name}`).join(", ");

	// Inline science glyph for tooltip income lines (same trick as the mil
	// tab's rating chips — a bare <img> resolved through the sprite manifest).
	const SCI_ICON = (() => {
		const url = getSpritePath("yields", "YIELD_SCIENCE");
		return url
			? `<img src="${url}" alt="science" style="display:inline;width:12px;height:12px;vertical-align:-1px"/>`
			: "science";
	})();

	function keyTechTooltip(m: ScienceTechMarker, color: string): string {
		const lines = m.usage
			.flatMap((u) => {
				if (u.kind === "line") {
					// Buildings across the whole line (Odeon/Theater/Amphitheater),
					// then the staffed specialists by tier (Apprentice/Master/Elder).
					// Both are the end-of-game snapshot — implied, not spelled out.
					const out = [namedCounts(u.buildings)];
					if (u.specialists.length > 0) out.push(namedCounts(u.specialists));
					// What that earns, as a floor (laws/wonders/modifiers stack).
					const income = [
						u.flat > 0 ? `+${u.flat} ${SCI_ICON}/turn` : null,
						u.pct > 0 ? `+${u.pct}% ${SCI_ICON}` : null,
					].filter((s): s is string => s != null);
					if (income.length > 0) out.push(`at least ${income.join(", ")}`);
					return out;
				}
				if (u.kind === "law")
					return [`Adopted ${formatEnum(u.law, "LAW_")} on T${u.turn}`];
				if (u.kind === "espionage")
					return [
						`Steal Research ×${u.turns.length} (T${u.turns.join(", T")})`,
					];
				return u.events.map((e) => `Expedition: ${e.name} (T${e.turn})`);
			})
			.map((t) => `<div style="color:${TOOLTIP_TEXT}">${t}</div>`)
			.join("");
		return (
			`<div style="font-size:12px;line-height:1.55">` +
			`<div style="font-weight:700;color:${color}">${techName(m.tech)} · T${m.turn}</div>` +
			`<div style="color:${TOOLTIP_MUTED};margin:3px 0 2px">Science payoff</div>` +
			lines +
			`</div>`
		);
	}

	function freeTechTooltip(m: FreeTechMarker, color: string): string {
		const source = m.sages
			? m.techs.length > 1
				? "Sages family seat founded this turn — one of these was its free tech (the save doesn't record which)"
				: "Sages family seat founded this turn — the seat grants a free tech"
			: "Research finishes one tech per turn; the rest were granted free (event, ruins, tribes)";
		const items = m.techs
			.map((t) => `<div style="color:${TOOLTIP_TEXT}">${techName(t)}</div>`)
			.join("");
		return (
			`<div style="font-size:12px;line-height:1.55">` +
			`<div style="font-weight:700;color:${color}">Free tech · T${m.turn}</div>` +
			`<div style="color:${TOOLTIP_MUTED};margin:3px 0 2px">${source}</div>` +
			items +
			`</div>`
		);
	}

	function spikeTooltip(s: ScienceSpike, color: string): string {
		// Best-effort attribution: the player's same-turn steal-research
		// missions / story events. Unattributed gains (ruins and tribe rewards
		// leave no trace; story_events is capped at 100) just read as an event.
		const sources =
			s.sources.length > 0
				? `<div style="color:${TOOLTIP_MUTED};margin:3px 0 2px">One-off gain — that turn:</div>` +
					s.sources
						.map((src) => `<div style="color:${TOOLTIP_TEXT}">${src}</div>`)
						.join("")
				: `<div style="color:${TOOLTIP_MUTED};margin-top:3px">One-off gain (event)</div>`;
		return (
			`<div style="font-size:12px;line-height:1.55">` +
			`<div style="font-weight:700;color:${color}">+${s.amount} science · T${s.turn}</div>` +
			sources +
			`</div>`
		);
	}

	// Row order within each player's band: key techs, free techs, one-off gains.
	const SCIENCE_RAIL_KINDS = ["key", "free", "event"] as const;

	// Per-player slices feeding both the rail markers and the one-off totals.
	const scienceRailData = $derived.by(() =>
		orderedPlayers.map((player) => {
			const techs = techsFor(player);
			const improvements = ownedByPlayer(
				improvementData.improvements,
				player,
				(i) => i.owner_player_xml_id,
				(i) => i.nation,
			);
			const laws =
				findByPlayer(
					lawAdoptionHistory,
					player,
					(l) => l.player_id,
					(l) => l.nation,
				)?.data ?? [];
			// Memory rows carry only player_xml_id (no nation), so there is no
			// nation fallback — legacy blobs simply yield no espionage markers.
			const stealTurns = memoryData
				.filter(
					(m) =>
						m.memory_type === STEAL_RESEARCH_MEMORY &&
						m.player_xml_id === player.playerId,
				)
				.map((m) => m.turn);
			const science =
				findByPlayer(
					allYields.filter((y) => y.yield_type === "YIELD_SCIENCE"),
					player,
					(y) => y.player_id,
					(y) => y.nation,
				)?.data ?? [];
			// Story rows key players by name (no id on StoryEvent).
			const expeditions = expeditionEvents(player.player_name, storyEvents);
			return {
				player,
				techs,
				improvements,
				laws,
				stealTurns,
				expeditions,
				science,
				spikes: scienceSpikes(
					science,
					player.player_name,
					stealTurns,
					storyEvents,
				),
			};
		}),
	);

	const scienceRailGroups = $derived.by<RailGroup[]>(() => {
		if (orderedPlayers.length !== 2) return [];
		return scienceRailData
			.map(
				({
					player,
					techs,
					improvements,
					laws,
					stealTurns,
					expeditions,
					spikes,
				}) => {
					const markers: Record<
						(typeof SCIENCE_RAIL_KINDS)[number],
						RailMarker[]
					> = {
						key: scienceTechMarkers(
							techs,
							improvements,
							laws,
							stealTurns,
							expeditions,
						).map((m) => ({
							turn: m.turn,
							iconCategory: "techs" as const,
							iconValue: m.tech,
							color: player.color,
							tooltipHtml: keyTechTooltip(m, player.color),
						})),
						free: freeTechMarkers(
							techs,
							sagesSeatFoundedTurn(
								player.playerId,
								families,
								cityStatistics.cities,
							),
						).map((m) => ({
							turn: m.turn,
							iconCategory: "techs" as const,
							// The first granted tech's icon; the full list is in the tooltip.
							iconValue: m.techs[0] ?? null,
							color: player.color,
							tooltipHtml: freeTechTooltip(m, player.color),
						})),
						event: spikes.map((s) => ({
							turn: s.turn,
							iconCategory: "yields" as const,
							iconValue: "YIELD_SCIENCE",
							color: player.color,
							tooltipHtml: spikeTooltip(s, player.color),
						})),
					};
					return {
						player,
						rows: SCIENCE_RAIL_KINDS.filter(
							(kind) => markers[kind].length > 0,
						).map((kind) => ({ kind, markers: markers[kind] })),
					};
				},
			)
			.filter((g) => g.rows.length > 0);
	});

	// Per-player sum of the one-off gains, for the caption under the rail.
	const oneOffTotals = $derived(
		scienceRailData
			.map(({ player, spikes }) => ({
				player,
				count: spikes.length,
				total: spikes.reduce((t, s) => t + s.amount, 0),
			}))
			.filter((t) => t.count > 0),
	);

	// ─── Where the science comes from ─────────────────────────────────
	// End-state itemized decomposition of each player's science/turn, side
	// by side: specialists and buildings/resources by name, science laws,
	// the exact percent modifiers (libraries, Musaeum) with their points
	// computed against each city's base, and the leader's court science.
	// Governors and the rest of the court (spouses, successors, courtiers,
	// council) are scaled by each character's opinion of the player, which
	// the save doesn't store — they stay in the signed "Other" remainder.

	// Null when the blob predates 2.11.0: UNKNOWN, not "not competitive".
	const competitive = $derived(
		gameOptions == null
			? null
			: gameOptions.GAMEOPTION_COMPETITIVE_MODE === true,
	);
	const characterById = $derived(new Map(characters.map((c) => [c.xml_id, c])));

	type BreakdownColumn = { player: DetailPlayer; b: ScienceBreakdown };
	const scienceBreakdowns = $derived.by<BreakdownColumn[]>(() => {
		const cols = scienceRailData.map(({ player, improvements, science }) => {
			const finalRate =
				[...science].reverse().find((d) => d.rate != null)?.rate ?? 0;
			// The player's laws still active at game end, and their capital
			// (both drive the conditional law sources).
			const activeLaws = new Set(
				ownedByPlayer(
					currentLaws,
					player,
					(l) => l.player_id,
					(l) => l.nation,
				).map((l) => l.law),
			);
			const cities = ownedByPlayer(
				cityStatistics.cities,
				player,
				(c) => c.owner_player_xml_id,
				(c) => c.owner_nation,
			);
			const capitalCity = cities.find((c) => c.is_capital);
			// The reigning leader's Wisdom — the only court rating that pays
			// science. Null on pre-2.11.0 blobs (no leader id) or when the
			// character is missing, which keeps the leader out of the breakdown
			// rather than pricing them at zero.
			//
			// A DEAD last leader means no reigning ruler: succession appends a
			// new id on every handover, so the tail of <Leaders> is dead only
			// for a realm that fell without anyone taking the throne. This is
			// an END-STATE decomposition, so a ruler off the throne earns
			// nothing — crediting them would invent science (and, for a fallen
			// realm whose rate is 0, a negative Other) out of nothing.
			const leaderId = player.leader_character_xml_id;
			const leader = leaderId == null ? null : characterById.get(leaderId);
			const leaderWisdom =
				leader == null || leader.death_turn != null
					? null
					: (leader.wisdom ?? null);
			return {
				player,
				b: scienceBreakdown(
					improvements,
					activeLaws,
					capitalCity
						? {
								cityName: capitalCity.city_name,
								cultureLevel: capitalCity.culture_level,
							}
						: null,
					cities.length,
					finalRate,
					leaderWisdom,
					competitive,
					specialistName,
					improvementDisplayName,
				),
			};
		});
		return cols.every((c) => c.b.total === 0) ? [] : cols;
	});

	// Row layout: per section, the union of item labels across players,
	// biggest first — ranked by one player when their header is clicked,
	// by the best value anywhere otherwise.
	const BREAKDOWN_SECTIONS = [
		{ key: "specialists", label: "Specialists" },
		{ key: "buildings", label: "Buildings & resources" },
		{ key: "laws", label: "Laws" },
		{ key: "modifiers", label: "Modifiers" },
		{ key: "court", label: "Court" },
	] as const;
	// Only sections somebody has items in — an all-zero section is noise.
	const visibleBreakdownSections = $derived(
		BREAKDOWN_SECTIONS.filter((s) =>
			scienceBreakdowns.some((c) => c.b[s.key].items.length > 0),
		),
	);
	let breakdownSortId = $state<number | null>(null);
	function toggleBreakdownSort(playerId: number) {
		breakdownSortId = breakdownSortId === playerId ? null : playerId;
	}
	function breakdownRows(
		key: (typeof BREAKDOWN_SECTIONS)[number]["key"],
	): string[] {
		const ranked =
			breakdownSortId != null
				? scienceBreakdowns.filter((c) => c.player.playerId === breakdownSortId)
				: scienceBreakdowns;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const best = new Map<string, number>();
		// Union over ALL players (so no row disappears), ranked by the sort set.
		for (const col of scienceBreakdowns) {
			for (const item of col.b[key].items) {
				if (!best.has(item.label)) best.set(item.label, 0);
			}
		}
		for (const col of ranked) {
			for (const item of col.b[key].items) {
				best.set(item.label, Math.max(best.get(item.label) ?? 0, item.science));
			}
		}
		return [...best].sort((a, b) => b[1] - a[1]).map(([label]) => label);
	}
	function breakdownItem(
		col: BreakdownColumn,
		key: (typeof BREAKDOWN_SECTIONS)[number]["key"],
		label: string,
	) {
		return col.b[key].items.find((i) => i.label === label);
	}
	// Common scale for the butterfly bars: the largest single item anywhere.
	// Section totals stay number-only — bars on a different implicit scale
	// would misread.
	const breakdownMaxItem = $derived(
		Math.max(
			1,
			...scienceBreakdowns.flatMap((col) =>
				BREAKDOWN_SECTIONS.flatMap((s) =>
					col.b[s.key].items.map((i) => i.science),
				),
			),
		),
	);

	// The live discovery-chart instance for the rail (same pattern as the
	// Military tab): marker x-positions come from convertToPixel; layoutTick
	// bumps on every re-layout so positions refresh.
	let railChart = $state<ECharts | null>(null);
	let railLayoutTick = $state(0);
	let railHighlight = $state<{ turn: number; color: string } | null>(null);
	const railHighlightLeft = $derived.by<number | null>(() => {
		const c = railChart;
		const h = railHighlight;
		// `railLayoutTick < 0` is always false but reads the signal.
		if (!c || !h || railLayoutTick < 0) return null;
		return c.convertToPixel({ xAxisIndex: 0 }, h.turn) as number;
	});

	// ─── Pivot table logic ────────────────────────────────────────────
	// Columns are per player (mirror-match safe); filtering stays by nation.
	const techColumnPlayers = $derived(
		players.filter(
			(p) =>
				ownedByPlayer(
					completedTechs,
					p,
					(t) => t.player_id,
					(t) => t.nation,
				).length > 0,
		),
	);

	const uniqueTechNations = $derived(
		[
			...new Set(
				techColumnPlayers
					.map((p) => p.nation)
					.filter((n): n is string => n != null),
			),
		].sort(),
	);

	const selectedTechNations = $derived(
		tableState.filters
			.filter((f) => f.startsWith("nation:"))
			.map((f) => f.replace("nation:", "")),
	);

	const displayedTechPlayers = $derived(
		selectedTechNations.length > 0
			? techColumnPlayers.filter(
					(p) => p.nation != null && selectedTechNations.includes(p.nation),
				)
			: techColumnPlayers,
	);

	type TechPivotRow = {
		tech: string;
		turns: Record<number, number | null>;
	};

	const techPivotData = $derived.by(() => {
		if (completedTechs.length === 0) return [];

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const pivotMap = new Map<string, Record<number, number | null>>();

		for (const p of techColumnPlayers) {
			for (const t of ownedByPlayer(
				completedTechs,
				p,
				(x) => x.player_id,
				(x) => x.nation,
			)) {
				if (!pivotMap.has(t.tech)) {
					pivotMap.set(t.tech, {});
				}
				pivotMap.get(t.tech)![p.playerId] = t.completed_turn;
			}
		}

		const rows: TechPivotRow[] = [];
		for (const [tech, turns] of pivotMap) {
			if (tableState.search) {
				const term = tableState.search.toLowerCase();
				if (!tech.toLowerCase().includes(term)) {
					continue;
				}
			}
			rows.push({ tech, turns });
		}

		rows.sort((a, b) => {
			if (tableState.sortColumn === "tech") {
				const cmp = a.tech.localeCompare(b.tech);
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			} else if (tableState.sortColumn.startsWith("player:")) {
				const id = Number(tableState.sortColumn.replace("player:", ""));
				const aVal = a.turns[id] ?? Infinity;
				const bVal = b.turns[id] ?? Infinity;
				const cmp = aVal - bVal;
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			}
			return a.tech.localeCompare(b.tech);
		});

		return rows;
	});
</script>

{#if techDiscoveryChartOption}
	<div
		class="mb-4 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		{#if scienceRailGroups.length > 0}
			<!-- Matchup variant: the plot plus the science event rail below it —
			     key-tech payoffs, free techs, one-off science gains — each marker
			     at its true turn-x on the live chart (mil-tab pattern). -->
			<div class="relative">
				<Chart
					option={techDiscoveryChartOption}
					height="360px"
					onReady={(c) => (railChart = c)}
					onLayout={() => (railLayoutTick += 1)}
				/>
				{#if railHighlight && railHighlightLeft != null}
					<div
						class="pointer-events-none absolute inset-y-0 z-10"
						style="left: {railHighlightLeft}px; width: 0; border-left: 1px dashed {railHighlight.color};"
					></div>
				{/if}
			</div>
			<EventRail
				chart={railChart}
				layoutTick={railLayoutTick}
				groups={scienceRailGroups}
				onHighlight={(h) => (railHighlight = h)}
			/>
			{#if oneOffTotals.length > 0}
				<div class="mt-2 flex flex-wrap items-center gap-3 text-xs">
					<span class="italic text-tan">Bonus science:</span>
					{#each oneOffTotals as t (t.player.playerId)}
						<span
							class="inline-flex items-center gap-1 font-semibold text-tan"
							title="Sum of turns where the science total jumped by more than that turn's production rate (gains of 10+; from the save's per-turn yield history)"
						>
							<span style="color: {t.player.color};">{t.player.label}</span>
							+{t.total}
							<SpriteIcon category="yields" value="YIELD_SCIENCE" size={12} />
							({t.count} event{t.count === 1 ? "" : "s"})
						</span>
					{/each}
				</div>
			{/if}
		{:else}
			<ChartContainer
				option={techDiscoveryChartOption}
				height="400px"
				title="Tech Discovery Over Time"
			/>
		{/if}
	</div>
{:else if techDiscoveryHistory.length === 0}
	<p class="p-8 text-center italic text-tan">
		No tech discovery data available
	</p>
{/if}

<!-- Side-by-side tech timeline: every tech at its turn, per player, with the
     planner deep links in the column headers. Shared techs read gold, so a
     tech only one player researched stands out in their color. -->
{#if completedTechs.length > 0}
	<TechComparison
		players={orderedPlayers}
		{completedTechs}
		{techDiscoveryHistory}
	/>
{/if}

<!-- End-state science-source decomposition, itemized, side by side. -->
{#if scienceBreakdowns.length > 0}
	<div
		class="mb-4 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<h3 class="mb-3 text-base font-bold text-tan">Science Sources</h3>
		<!-- One columnar layout for every game size (a mirrored butterfly can't
		     hold 3+ players). Per-source rows carry an inline bar on the shared
		     breakdownMaxItem scale; section/total rows stay number-only. Click a
		     player header to rank the rows by them. -->
		<div class="overflow-x-auto">
			<table class="w-full max-w-3xl text-sm">
				<thead>
					<tr>
						<th class="w-56 pb-2"></th>
						{#each scienceBreakdowns as col (col.player.playerId)}
							<th class="pb-2 pr-4 text-right">
								<button
									type="button"
									class="inline-flex cursor-pointer items-center gap-1.5 font-semibold"
									style="color: {col.player.color};"
									title="Rank sources by {col.player.label}"
									onclick={() => toggleBreakdownSort(col.player.playerId)}
								>
									{#if col.player.nation}
										<SpriteIcon
											category="crests"
											value={col.player.nation}
											size={15}
											alt={col.player.label}
										/>
									{/if}
									{col.player.label}
									{#if breakdownSortId === col.player.playerId}<span
											class="text-orange">↓</span
										>{/if}
								</button>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each visibleBreakdownSections as section (section.key)}
						<tr class="border-t border-border-subtle">
							<td class="py-1.5 font-semibold text-tan">{section.label}</td>
							{#each scienceBreakdowns as col (col.player.playerId)}
								<td class="py-1.5 pr-4 text-right font-semibold text-tan">
									{col.b[section.key].total}
								</td>
							{/each}
						</tr>
						{#each breakdownRows(section.key) as label (label)}
							<tr>
								<td class="py-0.5 pl-4 text-xs text-gray-400">{label}</td>
								{#each scienceBreakdowns as col (col.player.playerId)}
									{@const item = breakdownItem(col, section.key, label)}
									<td class="py-0.5 pr-4">
										{#if item}
											<div class="flex items-center justify-end gap-1.5">
												<div
													class="h-1.5 shrink rounded-sm"
													style="width: {(Math.max(0, item.science) /
														breakdownMaxItem) *
														100}%; max-width: 4rem; background: {col.player
														.color};"
												></div>
												<span
													class="shrink-0 whitespace-nowrap text-xs text-tan"
													>{#if item.count > 1}<span class="text-gray-400"
															>({item.count}×)&nbsp;</span
														>{/if}{item.science}</span
												>
											</div>
										{:else}
											<div class="text-right text-xs text-gray-400">—</div>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					{/each}
					<tr class="border-t border-border-subtle">
						<td class="py-1.5 font-semibold text-tan">Other</td>
						{#each scienceBreakdowns as col (col.player.playerId)}
							<td class="py-1.5 pr-4 text-right font-semibold text-tan">
								{col.b.other}
							</td>
						{/each}
					</tr>
					<tr class="border-t border-border-subtle">
						<td class="py-1.5 font-bold text-tan">
							<span class="inline-flex items-center gap-1">
								Science per turn
								<SpriteIcon category="yields" value="YIELD_SCIENCE" size={13} />
							</span>
						</td>
						{#each scienceBreakdowns as col (col.player.playerId)}
							<td class="py-1.5 pr-4 text-right font-bold text-tan">
								{col.b.total}
							</td>
						{/each}
					</tr>
				</tbody>
			</table>
		</div>
	</div>
{/if}

<!-- Completed Technologies Table -->
{#if completedTechs.length === 0}
	<div class="mt-8">
		<p class="p-8 text-center italic text-tan">
			No technologies data available
		</p>
	</div>
{:else}
	<div class={TABLE_FRAME_CLASS}>
		<TableFilterColumn
			bind:search={tableState.search}
			count={`${techPivotData.length} technologies`}
			chips={selectedTechNations.map((n) => formatEnum(n, "NATION_"))}
		>
			{#snippet filters()}
				<NationFilterSelect
					nations={uniqueTechNations}
					bind:value={tableState.filters}
				/>
			{/snippet}
		</TableFilterColumn>

		<!-- Technologies pivot table -->
		<div class="min-w-0 flex-1 overflow-x-auto">
			<table class={TABLE_CLASS}>
				<thead>
					<tr>
						<th
							class="{TABLE_HEADER_TH_CLASS} rounded-l-lg border-l {displayedTechPlayers.length ===
							0
								? 'rounded-r-lg border-r'
								: ''}"
							onclick={() => toggleSort(tableState, "tech")}
						>
							<span class="inline-flex items-center gap-1">
								Technology
								{#if tableState.sortColumn === "tech"}
									<span class="text-orange">
										{tableState.sortDirection === "asc" ? "↑" : "↓"}
									</span>
								{/if}
							</span>
						</th>
						{#each displayedTechPlayers as player, i (player.playerId)}
							<th
								class="{TABLE_HEADER_TH_CLASS} !text-center {i ===
								displayedTechPlayers.length - 1
									? 'rounded-r-lg border-r'
									: ''}"
								onclick={() =>
									toggleSort(tableState, `player:${player.playerId}`)}
							>
								<span class="inline-flex items-center justify-center gap-1.5">
									{#if player.nation}
										<SpriteIcon
											category="crests"
											value={player.nation}
											size={14}
											alt={formatEnum(player.nation, "NATION_")}
										/>
									{/if}
									{player.label}
									{#if tableState.sortColumn === `player:${player.playerId}`}
										<span class="text-orange">
											{tableState.sortDirection === "asc" ? "↑" : "↓"}
										</span>
									{/if}
								</span>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each techPivotData as row (row.tech)}
						<tr class="group">
							<td
								class="{TABLE_CELL_TD_CLASS} whitespace-nowrap rounded-l-lg {displayedTechPlayers.length ===
								0
									? 'rounded-r-lg'
									: ''}"
							>
								{techName(row.tech)}
							</td>
							{#each displayedTechPlayers as player, i (player.playerId)}
								<td
									class="{TABLE_CELL_TD_CLASS} whitespace-nowrap !text-center {i ===
									displayedTechPlayers.length - 1
										? 'rounded-r-lg'
										: ''}"
								>
									{row.turns[player.playerId] != null
										? row.turns[player.playerId]
										: "—"}
								</td>
							{/each}
						</tr>
					{:else}
						<tr>
							<td
								colspan={displayedTechPlayers.length + 1}
								class="p-8 text-center italic text-tan"
							>
								No technologies match search
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}
