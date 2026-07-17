<script lang="ts">
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import type { PlayerUnitProduced } from "$lib/types/PlayerUnitProduced";
	import type { LawAdoptionHistory } from "$lib/types/LawAdoptionHistory";
	import type { TechDiscoveryHistory } from "$lib/types/TechDiscoveryHistory";
	import type { CharacterInfo, UnitInfo } from "$lib/parser/types";
	import type { EChartsOption, ECharts } from "echarts";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import Chart from "$lib/Chart.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import { CHART_THEME, getNationChartColor } from "$lib/config";
	import { LAW_TO_CLASS } from "$lib/generated/law-classes";
	import { TECH_NAMES } from "$lib/generated/tech-names";
	import { TECH_BONUS_UNITS, UNIT_STATS } from "$lib/generated/unit-stats";
	import SpriteIcon from "./SpriteIcon.svelte";
	import EventRail, {
		TOOLTIP_TEXT,
		TOOLTIP_MUTED,
		type RailGroup,
		type RailMarker,
	} from "./EventRail.svelte";
	import BuildComparison, { type BuildItem } from "./BuildComparison.svelte";
	import TableFilterColumn from "./TableFilterColumn.svelte";
	import NationFilterSelect from "./NationFilterSelect.svelte";
	import {
		type TableState,
		type UnitClass,
		type DetailPlayer,
		TABLE_FRAME_CLASS,
		TABLE_CLASS,
		TABLE_HEADER_TH_CLASS,
		TABLE_CELL_TD_CLASS,
		ownedByPlayer,
		orderPlayersUploaderFirst,
		toggleSort,
		classifyUnit,
		getSpritePath,
		UNIT_CLASS_COLORS,
		filledLineStyle,
	} from "./helpers";

	let {
		players,
		playerHistory,
		unitsProduced,
		units = [],
		characters = [],
		lawAdoptionHistory = [],
		techDiscoveryHistory = [],
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
		playerHistory: PlayerHistory[];
		unitsProduced: PlayerUnitProduced[];
		units?: UnitInfo[];
		characters?: CharacterInfo[];
		lawAdoptionHistory?: LawAdoptionHistory[];
		techDiscoveryHistory?: TechDiscoveryHistory[];
		userNation?: string | null;
		chartFilter?: Record<string, boolean>;
		tableState?: TableState;
	} = $props();

	// Resolved identity lookup (stable label + color per player), keyed by the
	// player id that every per-player array carries. Mirror-match safe.
	const playerById = $derived(new Map(players.map((p) => [p.playerId, p])));

	// Canonical player order: uploader first, used everywhere this tab lists
	// the two sides (event bars + H2H blocks) so the ordering is consistent.
	const orderedPlayers = $derived(
		orderPlayersUploaderFirst(players, userNation),
	);

	// ─── Head-to-head build comparison ────────────────────────────────
	// owglick's Army blocks: Ending Army / Military Built / Civilian Built as
	// side-by-side diverging bars. Inherently a 1v1 framing, so it only renders
	// when exactly two sides are present; for FFA the pies + pivot table below
	// remain the N-player view.
	const matchup = $derived<[DetailPlayer, DetailPlayer] | null>(
		orderedPlayers.length === 2 ? [orderedPlayers[0], orderedPlayers[1]] : null,
	);

	// Combat units built by a player (civilian/support units — classifyUnit
	// null — are excluded), aggregated by unit type.
	function builtUnits(p: DetailPlayer): BuildItem[] {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const m = new Map<string, number>();
		for (const u of ownedByPlayer(
			unitsProduced,
			p,
			(x) => x.player_id,
			(x) => x.nation,
		)) {
			if (classifyUnit(u.unit_type) == null) continue;
			m.set(u.unit_type, (m.get(u.unit_type) ?? 0) + u.count);
		}
		return [...m].map(([unitType, count]) => ({ unitType, count }));
	}

	// Combat units alive at game end, from the ending unit roster (`units`),
	// aggregated by type. Returns the per-type breakdown plus the live total.
	function endingArmy(p: DetailPlayer): { items: BuildItem[]; total: number } {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const m = new Map<string, number>();
		let total = 0;
		for (const u of units) {
			if (u.player_xml_id !== p.playerId) continue;
			if (classifyUnit(u.unit_type) == null) continue;
			m.set(u.unit_type, (m.get(u.unit_type) ?? 0) + 1);
			total++;
		}
		return {
			items: [...m].map(([unitType, count]) => ({ unitType, count })),
			total,
		};
	}

	// Ending military power = last non-null point on the player's power curve.
	function endingPower(p: DetailPlayer): number | null {
		const hist = playerHistory.find((h) => h.player_id === p.playerId)?.history;
		if (!hist) return null;
		for (let i = hist.length - 1; i >= 0; i--) {
			if (hist[i].military_power != null) return hist[i].military_power;
		}
		return null;
	}

	const num = (n: number | null) => (n == null ? "—" : n.toLocaleString());

	// Total military power built = Σ (units built × strength × 10), since a
	// unit's military power is its displayed strength × 10 (the XML iStrength).
	const milpowerBuilt = (items: BuildItem[]): number =>
		items.reduce((t, it) => {
			const s = UNIT_STATS[it.unitType];
			return s ? t + it.count * s.strength * 10 : t;
		}, 0);

	type BuildBlock = {
		title: string;
		statA?: string;
		statB?: string;
		a: BuildItem[];
		b: BuildItem[];
		donutA: EChartsOption | null;
		donutB: EChartsOption | null;
	};
	const buildBlocks = $derived<BuildBlock[]>(
		matchup
			? (() => {
					const [a, b] = matchup;
					const milA = builtUnits(a);
					const milB = builtUnits(b);
					const blocks: BuildBlock[] = [
						{
							title: "Military Built",
							statA: num(milpowerBuilt(milA)),
							statB: num(milpowerBuilt(milB)),
							a: milA,
							b: milB,
							donutA: makeDonut(a.label, a.color, milA),
							donutB: makeDonut(b.label, b.color, milB),
						},
					];
					// Ending Army only when the blob carries the ending unit roster
					// (`units`); without it the counts would read "0 v 0 alive" next
					// to real power numbers. The roster is the save's full game state
					// (all units, not fog-limited — fog is a separate per-tile mask),
					// so the counts are complete for both sides.
					if (units.length > 0) {
						const armyA = endingArmy(a);
						const armyB = endingArmy(b);
						blocks.push({
							title: "Ending Army",
							statA: num(endingPower(a)),
							statB: num(endingPower(b)),
							a: armyA.items,
							b: armyB.items,
							donutA: makeDonut(a.label, a.color, armyA.items),
							donutB: makeDonut(b.label, b.color, armyB.items),
						});
					}
					return blocks;
				})()
			: [],
	);

	// Shared row order for the H2H build panels: the union of every unit type
	// appearing in any block (Military Built + Ending Army, both sides), sorted
	// by display name. Passing this into each BuildComparison lines the panels
	// up so a given unit sits on the same row in both — a type absent from one
	// panel shows there as a blank placeholder row.
	const sharedBuildUnitTypes = $derived<string[]>(
		[
			...new Set(
				buildBlocks.flatMap((bl) => [
					...bl.a.map((it) => it.unitType),
					...bl.b.map((it) => it.unitType),
				]),
			),
		].sort((p, q) =>
			formatEnum(p, "UNIT_").localeCompare(formatEnum(q, "UNIT_")),
		),
	);

	// ─── Annotation layer ─────────────────────────────────────────────
	// The military-power chart stays a clean single plot; game-event annotations
	// (leader successions, law changes, unit-tech unlocks) render as an
	// <EventRail> below it — one tinted band per nation, one row per event kind,
	// each marker at its event's true turn-x on the live chart.

	// Turn range of the plot's value x-axis (min/max in militaryChartOption).
	const axisTurns = $derived<number[]>(
		playerHistory[0]?.history.map((h) => h.turn) ?? [],
	);

	// Rating chip for the leader tooltip: the in-game stat icon + value.
	function ratingChip(
		label: string,
		key: string,
		value: number | null,
	): string {
		if (value == null) return "";
		const url = getSpritePath("icons", key);
		const ic = url
			? `<img src="${url}" alt="${label}" style="width:13px;height:13px"/>`
			: `${label}`;
		return `<span style="display:inline-flex;align-items:center;gap:3px">${ic}${value}</span>`;
	}

	// Rich tooltip for a leader marker, borrowing LeaderCard's field set: name
	// (+ cognomen), archetype, crowned turn, and the four character ratings,
	// each shown with its in-game stat icon.
	function leaderTooltip(
		c: CharacterInfo,
		turn: number,
		color: string,
	): string {
		const name = c.first_name ? formatEnum(c.first_name, "NAME_") : "New ruler";
		const cog = c.cognomen ? ` ‘${formatEnum(c.cognomen, "COGNOMEN_")}’` : "";
		const arch = c.archetype
			? formatEnum(c.archetype.replace(/_ARCHETYPE$/, ""), "TRAIT_")
			: null;
		const ratings = [
			ratingChip("Wis", "RATING_WISDOM", c.wisdom),
			ratingChip("Cha", "RATING_CHARISMA", c.charisma),
			ratingChip("Cou", "RATING_COURAGE", c.courage),
			ratingChip("Dis", "RATING_DISCIPLINE", c.discipline),
		].join("");
		return (
			`<div style="font-size:12px;line-height:1.5">` +
			`<div style="font-weight:700;color:${color}">${name}${cog}</div>` +
			`<div style="color:${TOOLTIP_TEXT}">${arch ? `${arch} · ` : ""}crowned T${turn}</div>` +
			(ratings
				? `<div style="display:flex;gap:11px;margin-top:4px">${ratings}</div>`
				: "") +
			`</div>`
		);
	}

	// Tooltip for a law change: what was adopted/swapped, the running count, and
	// the full set of laws active afterward (each with its icon).
	function lawEventTooltip(
		law: string,
		count: number,
		turn: number,
		swappedFrom: string | null,
		color: string,
		active: string[],
	): string {
		const header = swappedFrom
			? `Switched ${formatEnum(swappedFrom, "LAW_")} → ${formatEnum(law, "LAW_")}`
			: `Adopted ${formatEnum(law, "LAW_")}`;
		const items = active
			.map((l) => {
				const url = getSpritePath("laws", l);
				const ic = url
					? `<img src="${url}" alt="" style="width:14px;height:14px"/>`
					: "";
				return `<div style="display:flex;align-items:center;gap:6px;color:${TOOLTIP_TEXT}">${ic}<span>${formatEnum(l, "LAW_")}</span></div>`;
			})
			.join("");
		return (
			`<div style="font-size:12px;line-height:1.55">` +
			`<div style="font-weight:700;color:${color}">${header}</div>` +
			`<div style="color:${TOOLTIP_MUTED}">Law ${count} · T${turn}</div>` +
			`<div style="color:${TOOLTIP_MUTED};margin:3px 0 2px">Laws active</div>` +
			items +
			`</div>`
		);
	}

	// Per-player event rail: leader successions (incl. the starting ruler), law
	// changes, and unit-tech unlocks. Each event's marker x is convertToPixel(turn)
	// on the live chart, laid out in a horizontal per-nation band below the plot.
	// A rail marker plus this tab's row kind — everything else (turn,
	// icon, color, tooltipHtml) is EventRail's shared marker shape.
	type RailEventKind = "leader" | "law" | "tech";
	type RailEvent = RailMarker & { kind: RailEventKind };

	// Unit strength tiers worth flagging (displayed strength). Reaching the tech
	// that first fields a 5/6/8/10-str unit is a military power spike.
	const TARGET_STRENGTHS = new Set([5, 6, 8, 10]);

	// Naval is "relevant" for a player only when THAT player actually built a
	// sea unit — otherwise their boat techs (Navigation, etc.) are noise and
	// stay hidden. Gated per-player, not whole-game, so one side's navy doesn't
	// surface the other's boat-tech markers.
	function navalRelevantFor(playerId: number): boolean {
		return unitsProduced.some(
			(u) => u.player_id === playerId && UNIT_STATS[u.unit_type]?.naval,
		);
	}

	const techName = (tech: string) =>
		TECH_NAMES[tech] ?? formatEnum(tech, "TECH_");

	// One unit line inside a tech/bonus marker tooltip: icon, (count ×) name,
	// strength.
	function unitTooltipLine(
		u: { unitType: string; strength: number; naval: boolean },
		count?: number,
	): string {
		const url = getSpritePath("units", u.unitType);
		const ic = url
			? `<img src="${url}" alt="" style="width:15px;height:15px"/>`
			: "";
		const qty = count != null ? `${count}× ` : "";
		return `<div style="display:flex;align-items:center;gap:6px;color:${TOOLTIP_TEXT}">${ic}<span>${qty}${formatEnum(u.unitType, "UNIT_")}</span><span style="color:${TOOLTIP_MUTED}">str ${u.strength}${u.naval ? " · sea" : ""}</span></div>`;
	}

	// Tooltip for a unit-tech-unlock marker: the tech + the qualifying units it
	// unlocks (with strength).
	function techEventTooltip(
		tech: string,
		turn: number,
		unlocked: { unitType: string; strength: number; naval: boolean }[],
		color: string,
	): string {
		return (
			`<div style="font-size:12px;line-height:1.55">` +
			`<div style="font-weight:700;color:${color}">${techName(tech)} · T${turn}</div>` +
			`<div style="color:${TOOLTIP_MUTED};margin:3px 0 2px">Unlocks</div>` +
			unlocked.map((u) => unitTooltipLine(u)).join("") +
			`</div>`
		);
	}

	// Tooltip for a bonus-card marker: the card + the units it granted outright.
	function bonusEventTooltip(
		tech: string,
		turn: number,
		granted: {
			unitType: string;
			count: number;
			strength: number;
			naval: boolean;
		}[],
		color: string,
	): string {
		return (
			`<div style="font-size:12px;line-height:1.55">` +
			`<div style="font-weight:700;color:${color}">${techName(tech)} · T${turn}</div>` +
			`<div style="color:${TOOLTIP_MUTED};margin:3px 0 2px">Bonus card · granted</div>` +
			granted.map((u) => unitTooltipLine(u, u.count)).join("") +
			`</div>`
		);
	}

	const eventRail = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const byPlayer = new Map<number, RailEvent[]>();

		playerHistory.forEach((player, playerIdx) => {
			const color =
				playerById.get(player.player_id)?.color ??
				getNationChartColor(player.nation, playerIdx);
			const playerNaval = navalRelevantFor(player.player_id);
			const events: RailEvent[] = [];

			// Leaders, including the starting ruler.
			for (const c of characters
				.filter(
					(c) =>
						c.player_xml_id === player.player_id &&
						c.became_leader_turn != null,
				)
				.sort(
					(a, b) => (a.became_leader_turn ?? 0) - (b.became_leader_turn ?? 0),
				)) {
				const turn = c.became_leader_turn as number;
				const archKey = c.archetype
					? c.archetype.replace(/_ARCHETYPE$/, "")
					: null;
				events.push({
					kind: "leader",
					turn,
					iconCategory: "traits-trimmed",
					iconValue: archKey,
					color,
					tooltipHtml: leaderTooltip(c, turn, color),
				});
			}

			// Every law change (adoption or swap), with the specific law's icon and
			// the running total active. The active set is tracked per law class so
			// swaps replace rather than add.
			const laws = lawAdoptionHistory.find(
				(l) => l.player_id === player.player_id,
			);
			if (laws) {
				const currentByClass: Record<string, string> = {};
				for (const d of laws.data) {
					if (d.law_name == null) continue;
					const cls = LAW_TO_CLASS[d.law_name];
					const prior = cls != null ? currentByClass[cls] : undefined;
					const swapped = prior != null && prior !== d.law_name;
					currentByClass[cls ?? `_${d.law_name}`] = d.law_name;
					events.push({
						kind: "law",
						turn: d.turn,
						// The adopted law's own icon; the full active set for the class
						// (and any swap-out) is in the hover tooltip.
						iconCategory: "laws",
						iconValue: d.law_name,
						color,
						tooltipHtml: lawEventTooltip(
							d.law_name,
							d.law_count,
							d.turn,
							swapped ? (prior ?? null) : null,
							color,
							Object.values(currentByClass),
						),
					});
				}
			}

			// Unit-tech unlocks: techs that field a 5/6/8/10-str unit. One marker
			// per qualifying tech-discovery turn; the tooltip lists every unit it
			// unlocks. Naval units are included only when naval is relevant.
			// Bonus cards that grant combat units outright (e.g. 2× a unique unit)
			// get their own marker — the units materialize, so no strength or
			// naval gate applies.
			const techHist = techDiscoveryHistory.find(
				(t) => t.player_id === player.player_id,
			);
			if (techHist) {
				for (const d of techHist.data) {
					if (d.tech_name == null) continue;
					const granted = (TECH_BONUS_UNITS[d.tech_name] ?? [])
						.filter((g) => classifyUnit(g.unit) != null)
						.map((g) => ({
							unitType: g.unit,
							count: g.count,
							strength: UNIT_STATS[g.unit]?.strength ?? 0,
							naval: UNIT_STATS[g.unit]?.naval ?? false,
						}))
						.sort((x, y) => y.strength - x.strength);
					if (granted.length > 0) {
						events.push({
							kind: "tech",
							turn: d.turn,
							iconCategory: "units",
							iconValue: granted[0].unitType,
							color,
							tooltipHtml: bonusEventTooltip(
								d.tech_name,
								d.turn,
								granted,
								color,
							),
						});
					}
					const unlocked = Object.entries(UNIT_STATS)
						.filter(
							([, s]) =>
								s.tech === d.tech_name &&
								TARGET_STRENGTHS.has(s.strength) &&
								(playerNaval || !s.naval),
						)
						.map(([unitType, s]) => ({
							unitType,
							strength: s.strength,
							naval: s.naval,
						}))
						.sort((x, y) => y.strength - x.strength);
					if (unlocked.length === 0) continue;
					events.push({
						kind: "tech",
						turn: d.turn,
						// The sprite of the strongest unit this tech unlocks (`unlocked` is
						// sorted by strength desc); the tech and the full unit list are in
						// the hover tooltip.
						iconCategory: "units",
						iconValue: unlocked[0].unitType,
						color,
						tooltipHtml: techEventTooltip(d.tech_name, d.turn, unlocked, color),
					});
				}
			}

			events.sort((a, b) => a.turn - b.turn);
			byPlayer.set(player.player_id, events);
		});

		return byPlayer;
	});

	// Row order within each nation's band: leaders, then laws, then techs.
	const RAIL_KINDS: RailEventKind[] = ["leader", "law", "tech"];

	// The live ECharts instance (approach B). The rail is DOM (EventRail), but
	// each marker's x-position comes from the chart via convertToPixel;
	// `layoutTick` bumps on every chart re-layout (init / option change /
	// resize) so positions refresh.
	let chart = $state<ECharts | null>(null);
	let layoutTick = $state(0);

	// ─── Rail groups (one row per event kind) ────────────────────────
	// Each nation's band splits into up to three rows — leaders, laws, techs —
	// so every icon type sits on its own line. Layout, marker merging, and the
	// hover tooltip live in EventRail; this just shapes the data.

	const railGroups = $derived.by<RailGroup[]>(() => {
		if (!matchup) return [];
		return orderedPlayers
			.map((player) => {
				const evs = eventRail.get(player.playerId) ?? [];
				const rows = RAIL_KINDS.filter((k) =>
					evs.some((e) => e.kind === k),
				).map((kind) => ({
					kind,
					markers: evs
						.filter((e) => e.kind === kind)
						.sort((a, b) => a.turn - b.turn),
				}));
				return { player, rows };
			})
			.filter((g) => g.rows.length > 0);
	});

	// Hovering a rail marker (EventRail's onHighlight) drops a vertical guide
	// line on the plot at that turn (x resolved from the live chart).
	let highlight = $state<{ turn: number; color: string } | null>(null);
	const highlightLeft = $derived.by<number | null>(() => {
		const c = chart;
		const h = highlight;
		// `layoutTick < 0` is always false but reads the signal to track re-layout.
		if (!c || !h || layoutTick < 0) return null;
		return c.convertToPixel({ xAxisIndex: 0 }, h.turn) as number;
	});

	// ─── Chart option ─────────────────────────────────────────────────
	// A single power plot (approach B): the event rail is separate DOM below,
	// positioned from this chart via convertToPixel — so nothing here reserves
	// fixed pixel edges. A little turn-axis padding keeps the first/last event
	// markers clear of the axis lines.
	const militaryChartOption = $derived.by<EChartsOption | null>(() => {
		if (!playerHistory) return null;
		const turns = axisTurns;
		const minTurn = turns[0] ?? 0;
		const maxTurn = turns[turns.length - 1] ?? 0;
		const pad = Math.max(1, (maxTurn - minTurn) * 0.02);
		return {
			...CHART_THEME,
			title: { ...CHART_THEME.title, text: "Military Power" },
			legend: {
				show: false,
				data: playerHistory.map(
					(p) =>
						playerById.get(p.player_id)?.label ??
						formatEnum(p.nation, "NATION_"),
				),
				selected: chartFilter,
			},
			grid: { top: 44, left: 8, right: 20, bottom: 24, containLabel: true },
			tooltip: { trigger: "axis" },
			xAxis: {
				type: "value",
				min: minTurn - pad,
				max: maxTurn + pad,
				minInterval: 1,
				splitLine: { show: false },
			},
			yAxis: {
				type: "value",
				// Draw the y-axis at the left edge, not at x=0. The turn axis min is
				// negative (minTurn − pad, with minTurn = 0), so the default onZero
				// behaviour would otherwise render the axis line inside the plot at
				// turn 0.
				axisLine: { onZero: false },
			},
			series: playerHistory.map((player, i) => {
				const rp = playerById.get(player.player_id);
				const fillColor = rp?.color ?? getNationChartColor(player.nation, i);
				return {
					name: rp?.label ?? formatEnum(player.nation, "NATION_"),
					type: "line" as const,
					data: player.history.map((h) => [h.turn, h.military_power]),
					itemStyle: { color: rp?.color },
					...filledLineStyle(fillColor),
				};
			}),
		} as EChartsOption;
	});

	// ─── Army composition donuts ──────────────────────────────────────
	// Build a class-composition donut (Infantry/Ranged/Mounted/Siege/Water)
	// from a set of units, or null when there are no combat units. Used both
	// for the standalone per-player donuts (FFA) and the per-block donuts under
	// each H2H comparison.
	function makeDonut(
		label: string,
		color: string,
		items: BuildItem[],
	): EChartsOption | null {
		const classCounts: Partial<Record<UnitClass, number>> = {};
		for (const it of items) {
			const cls = classifyUnit(it.unitType);
			if (cls == null) continue;
			classCounts[cls] = (classCounts[cls] ?? 0) + it.count;
		}
		const slices = (Object.entries(classCounts) as [UnitClass, number][])
			.filter(([, count]) => count > 0)
			.sort(([, a], [, b]) => b - a);
		if (slices.length === 0) return null;

		return {
			backgroundColor: "transparent",
			animation: false,
			title: {
				text: label,
				left: "center",
				top: 4,
				textStyle: { color, fontSize: 12 },
			},
			tooltip: {
				trigger: "item",
				formatter: (params: any) =>
					`${params.name}: ${params.value} (${params.percent}%)`,
			},
			series: [
				{
					type: "pie",
					radius: ["34%", "62%"],
					center: ["50%", "56%"],
					avoidLabelOverlap: false,
					label: {
						show: true,
						position: "outside",
						formatter: "{b} {d}%",
						fontSize: 9,
						color: "#D2B48C",
					},
					labelLine: {
						show: true,
						length: 6,
						length2: 5,
						lineStyle: { color: "#666" },
					},
					data: slices.map(([unitClass, count]) => ({
						name: unitClass,
						value: count,
						itemStyle: { color: UNIT_CLASS_COLORS[unitClass] },
					})),
				},
			],
		};
	}

	// Standalone per-player donuts (units built), shown for FFA / non-matchup
	// games where the per-block donuts below don't apply.
	type ArmyPieData = { playerId: number; pieOption: EChartsOption };
	const armyPieCharts = $derived<ArmyPieData[]>(
		players
			.map((p) => {
				const items = ownedByPlayer(
					unitsProduced,
					p,
					(u) => u.player_id,
					(u) => u.nation,
				).map((u) => ({ unitType: u.unit_type, count: u.count }));
				const opt = makeDonut(p.label, p.color, items);
				return opt ? { playerId: p.playerId, pieOption: opt } : null;
			})
			.filter((d): d is ArmyPieData => d != null),
	);

	// ─── Units pivot table logic ──────────────────────────────────────
	// Columns are per player (mirror-match safe); filtering stays by nation.
	const unitColumnPlayers = $derived(
		players.filter(
			(p) =>
				ownedByPlayer(
					unitsProduced,
					p,
					(u) => u.player_id,
					(u) => u.nation,
				).length > 0,
		),
	);

	const uniqueUnitNations = $derived(
		[
			...new Set(
				unitColumnPlayers
					.map((p) => p.nation)
					.filter((n): n is string => n != null),
			),
		].sort(),
	);

	const selectedUnitNations = $derived(
		tableState.filters
			.filter((f) => f.startsWith("nation:"))
			.map((f) => f.replace("nation:", "")),
	);

	const displayedUnitPlayers = $derived(
		selectedUnitNations.length > 0
			? unitColumnPlayers.filter(
					(p) => p.nation != null && selectedUnitNations.includes(p.nation),
				)
			: unitColumnPlayers,
	);

	type UnitPivotRow = {
		unit_type: string;
		counts: Record<number, number>;
		total: number;
	};

	const unitPivotData = $derived.by(() => {
		if (unitsProduced.length === 0) return [];

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used locally in function, not as reactive state
		const pivotMap = new Map<string, Record<number, number>>();

		for (const p of unitColumnPlayers) {
			for (const u of ownedByPlayer(
				unitsProduced,
				p,
				(x) => x.player_id,
				(x) => x.nation,
			)) {
				if (!pivotMap.has(u.unit_type)) {
					pivotMap.set(u.unit_type, {});
				}
				const counts = pivotMap.get(u.unit_type)!;
				counts[p.playerId] = (counts[p.playerId] ?? 0) + u.count;
			}
		}

		const rows: UnitPivotRow[] = [];
		for (const [unit_type, counts] of pivotMap) {
			if (tableState.search) {
				const term = tableState.search.toLowerCase();
				if (!unit_type.toLowerCase().includes(term)) {
					continue;
				}
			}
			const total = displayedUnitPlayers.reduce(
				(sum, p) => sum + (counts[p.playerId] ?? 0),
				0,
			);
			rows.push({ unit_type, counts, total });
		}

		rows.sort((a, b) => {
			if (tableState.sortColumn === "unit_type") {
				const cmp = a.unit_type.localeCompare(b.unit_type);
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			} else if (tableState.sortColumn === "total") {
				const cmp = a.total - b.total;
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			} else if (tableState.sortColumn.startsWith("player:")) {
				const id = Number(tableState.sortColumn.replace("player:", ""));
				const cmp = (a.counts[id] ?? 0) - (b.counts[id] ?? 0);
				return tableState.sortDirection === "asc" ? cmp : -cmp;
			}
			return a.unit_type.localeCompare(b.unit_type);
		});

		return rows;
	});
</script>

{#if militaryChartOption || armyPieCharts.length > 0}
	<div
		class="mb-4 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<!-- Military Power Chart -->
		{#if militaryChartOption}
			{#if matchup}
				<!-- Approach B: a single power plot (Chart, not ChartContainer, so we hold the instance) with a DOM event rail below — one row per event kind per nation (leader / law / tech), each marker at its event's true turn-x (convertToPixel). -->
				<div class="relative">
					<Chart
						option={militaryChartOption}
						height="360px"
						onReady={(c) => (chart = c)}
						onLayout={() => (layoutTick += 1)}
					/>
					{#if highlight && highlightLeft != null}
						<div
							class="pointer-events-none absolute inset-y-0 z-10"
							style="left: {highlightLeft}px; width: 0; border-left: 1px dashed {highlight.color};"
						></div>
					{/if}
				</div>

				<EventRail
					{chart}
					{layoutTick}
					groups={railGroups}
					onHighlight={(h) => (highlight = h)}
				/>
			{:else}
				<ChartContainer
					option={militaryChartOption}
					height="400px"
					title="Military Power"
				/>
			{/if}
		{/if}

		<!-- Standalone army-composition donuts: only for FFA / non-matchup
		     games (in a 1v1 the per-block donuts below take over). -->
		{#if armyPieCharts.length > 0 && !matchup}
			<div
				class="{militaryChartOption ? 'mt-4 ' : ''}grid gap-4"
				style="grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));"
			>
				{#each armyPieCharts as pie (pie.playerId)}
					<div class="overflow-hidden rounded-lg">
						<Chart option={pie.pieOption} height="200px" />
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<!-- Head-to-head build comparison (two-player matchups only). Each block
     carries its own pair of class-composition donuts beneath it. -->
{#if buildBlocks.length > 0 && matchup}
	<div
		class="mb-4 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<div class="grid gap-4 md:grid-cols-2 md:grid-rows-[auto_auto]">
			{#each buildBlocks as block (block.title)}
				<div
					class="flex flex-col gap-3 md:row-span-2 md:grid md:grid-rows-subgrid"
				>
					<BuildComparison
						title={block.title}
						statA={block.statA}
						statB={block.statB}
						a={block.a}
						b={block.b}
						ca={matchup[0].color}
						cb={matchup[1].color}
						unitTypes={sharedBuildUnitTypes}
					/>
					{#if block.donutA || block.donutB}
						<div class="grid grid-cols-2 gap-2">
							{#if block.donutA}
								<div
									class="overflow-hidden rounded-md border border-border-subtle bg-surface-sunken"
								>
									<Chart option={block.donutA} height="168px" />
								</div>
							{/if}
							{#if block.donutB}
								<div
									class="overflow-hidden rounded-md border border-border-subtle bg-surface-sunken"
								>
									<Chart option={block.donutB} height="168px" />
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}

<!-- Units Produced Table -->
{#if unitsProduced.length > 0}
	<h3 class="mb-2 font-bold text-tan">Units Produced</h3>
	<div class={TABLE_FRAME_CLASS}>
		<TableFilterColumn
			bind:search={tableState.search}
			count={`${unitPivotData.length} unit types`}
			chips={selectedUnitNations.map((n) => formatEnum(n, "NATION_"))}
		>
			{#snippet filters()}
				<NationFilterSelect
					nations={uniqueUnitNations}
					bind:value={tableState.filters}
				/>
			{/snippet}
		</TableFilterColumn>

		<!-- Units Pivot Table -->
		<div class="min-w-0 flex-1 overflow-x-auto">
			<table class={TABLE_CLASS}>
				<thead>
					<tr>
						<th
							class="{TABLE_HEADER_TH_CLASS} rounded-l-lg border-l {displayedUnitPlayers.length ===
							0
								? 'rounded-r-lg border-r'
								: ''}"
							onclick={() => toggleSort(tableState, "unit_type")}
						>
							<span class="inline-flex items-center gap-1">
								Unit
								{#if tableState.sortColumn === "unit_type"}
									<span class="text-orange">
										{tableState.sortDirection === "asc" ? "↑" : "↓"}
									</span>
								{/if}
							</span>
						</th>
						{#each displayedUnitPlayers as player (player.playerId)}
							<th
								class="{TABLE_HEADER_TH_CLASS} !text-right {displayedUnitPlayers.length ===
								1
									? 'rounded-r-lg border-r'
									: ''}"
								onclick={() =>
									toggleSort(tableState, `player:${player.playerId}`)}
							>
								<span class="inline-flex items-center justify-end gap-1.5">
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
						{#if displayedUnitPlayers.length > 1}
							<th
								class="{TABLE_HEADER_TH_CLASS} rounded-r-lg border-r !text-right"
								onclick={() => toggleSort(tableState, "total")}
							>
								<span class="inline-flex items-center justify-end gap-1">
									Total
									{#if tableState.sortColumn === "total"}
										<span class="text-orange">
											{tableState.sortDirection === "asc" ? "↑" : "↓"}
										</span>
									{/if}
								</span>
							</th>
						{/if}
					</tr>
				</thead>
				<tbody>
					{#each unitPivotData as row (row.unit_type)}
						<tr class="group">
							<td
								class="{TABLE_CELL_TD_CLASS} whitespace-nowrap rounded-l-lg {displayedUnitPlayers.length ===
								0
									? 'rounded-r-lg'
									: ''}"
							>
								{formatEnum(row.unit_type, "UNIT_")}
							</td>
							{#each displayedUnitPlayers as player (player.playerId)}
								<td
									class="{TABLE_CELL_TD_CLASS} whitespace-nowrap !text-right {displayedUnitPlayers.length ===
									1
										? 'rounded-r-lg'
										: ''}"
								>
									{row.counts[player.playerId] ?? 0}
								</td>
							{/each}
							{#if displayedUnitPlayers.length > 1}
								<td
									class="{TABLE_CELL_TD_CLASS} whitespace-nowrap rounded-r-lg !text-right font-bold"
								>
									{row.total}
								</td>
							{/if}
						</tr>
					{:else}
						<tr>
							<td
								colspan={displayedUnitPlayers.length + 2}
								class="p-8 text-center italic text-tan"
							>
								No units match search
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{:else}
	<p class="p-8 text-center italic text-tan">
		No unit production data available
	</p>
{/if}
