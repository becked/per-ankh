<script lang="ts">
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import type { PlayerUnitProduced } from "$lib/types/PlayerUnitProduced";
	import type { LawAdoptionHistory } from "$lib/types/LawAdoptionHistory";
	import type { TechDiscoveryHistory } from "$lib/types/TechDiscoveryHistory";
	import type { CharacterInfo, UnitInfo } from "$lib/parser/types";
	import type { EChartsOption } from "echarts";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import Chart from "$lib/Chart.svelte";
	import { formatEnum } from "$lib/utils/formatting";
	import { CHART_THEME } from "$lib/config";
	import { LAW_TO_CLASS } from "$lib/generated/law-classes";
	import { UNIT_STATS } from "$lib/generated/unit-stats";
	import SpriteIcon from "./SpriteIcon.svelte";
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
		toggleSort,
		classifyUnit,
		getSpritePath,
		UNIT_CLASS_COLORS,
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

	// Canonical player order: the save's uploader ("player") first, then the
	// rest in their existing order. Used everywhere this tab lists the two
	// sides (event bars + H2H blocks) so the ordering is consistent. Observer /
	// archival uploads (no userNation) keep the existing order.
	const orderedPlayers = $derived(
		userNation
			? [...players].sort(
					(a, b) =>
						(a.nation === userNation ? 0 : 1) -
						(b.nation === userNation ? 0 : 1),
				)
			: players,
	);

	// ─── Head-to-head build comparison ────────────────────────────────
	// owglick's Army blocks: Ending Army / Military Built / Civilian Built as
	// side-by-side diverging bars. Inherently a 1v1 framing, so it only renders
	// when exactly two sides are present; for FFA the pies + pivot table below
	// remain the N-player view.
	const matchup = $derived<[DetailPlayer, DetailPlayer] | null>(
		orderedPlayers.length === 2 ? [orderedPlayers[0], orderedPlayers[1]] : null,
	);

	// Units built by a player, split into combat (classifyUnit != null) vs
	// civilian/support (null), aggregated by unit type.
	function builtUnits(p: DetailPlayer, combat: boolean): BuildItem[] {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const m = new Map<string, number>();
		for (const u of ownedByPlayer(
			unitsProduced,
			p,
			(x) => x.player_id,
			(x) => x.nation,
		)) {
			if ((classifyUnit(u.unit_type) != null) !== combat) continue;
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

	const sum = (items: BuildItem[]) => items.reduce((t, it) => t + it.count, 0);
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
		sub?: string;
		a: BuildItem[];
		b: BuildItem[];
		donutA: EChartsOption | null;
		donutB: EChartsOption | null;
	};
	const buildBlocks = $derived<BuildBlock[]>(
		matchup
			? (() => {
					const [a, b] = matchup;
					const armyA = endingArmy(a);
					const armyB = endingArmy(b);
					const milA = builtUnits(a, true);
					const milB = builtUnits(b, true);
					return [
						{
							title: "Military Built",
							sub: `${sum(milA)} v ${sum(milB)} total · ${num(
								milpowerBuilt(milA),
							)} v ${num(milpowerBuilt(milB))} power built`,
							a: milA,
							b: milB,
							donutA: makeDonut(a.label, a.color, milA),
							donutB: makeDonut(b.label, b.color, milB),
						},
						{
							title: "Ending Army",
							sub: `${armyA.total} v ${armyB.total} alive · ${num(
								endingPower(a),
							)} v ${num(endingPower(b))} power`,
							a: armyA.items,
							b: armyB.items,
							donutA: makeDonut(a.label, a.color, armyA.items),
							donutB: makeDonut(b.label, b.color, armyB.items),
						},
					];
				})()
			: [],
	);

	// ─── Annotation layer ─────────────────────────────────────────────
	// The military-power chart keeps gradient area fills (owglick's milStory
	// look) but stays uncluttered: game-event annotations — leader successions
	// (incl. the starting ruler) and the 4th/7th-law milestones — live in the
	// per-nation event bars above the chart, aligned to the turn axis.
	// Player color → rgba at a given alpha, for the gradient area fill.
	function toRgba(c: string, a: number): string {
		if (c.startsWith("#")) {
			let h = c.slice(1);
			if (h.length === 3)
				h = h
					.split("")
					.map((x) => x + x)
					.join("");
			const n = parseInt(h, 16);
			return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
		}
		const m = c.match(/rgba?\(([^)]+)\)/);
		if (m) {
			const [r, g, b] = m[1].split(",").map((x) => x.trim());
			return `rgba(${r},${g},${b},${a})`;
		}
		return c;
	}

	// Turn values of the shared x-axis (category type), used to snap an event
	// turn onto a real category so the guide line lands at the right place.
	const axisTurns = $derived<number[]>(
		playerHistory[0]?.history.map((h) => h.turn) ?? [],
	);
	function nearest(turns: number[], turn: number): number {
		if (turns.length === 0) return turn;
		return turns.reduce((best, t) =>
			Math.abs(t - turn) < Math.abs(best - turn) ? t : best,
		);
	}

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
			`<div style="color:#cfc9bd">${arch ? `${arch} · ` : ""}crowned T${turn}</div>` +
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
				return `<div style="display:flex;align-items:center;gap:6px;color:#cfc9bd">${ic}<span>${formatEnum(l, "LAW_")}</span></div>`;
			})
			.join("");
		return (
			`<div style="font-size:12px;line-height:1.55">` +
			`<div style="font-weight:700;color:${color}">${header}</div>` +
			`<div style="color:#9b948a">Law ${count} · T${turn}</div>` +
			`<div style="color:#9b948a;margin:3px 0 2px">Laws active</div>` +
			items +
			`</div>`
		);
	}

	// Per-player event rail: leader successions (incl. the starting ruler) and
	// the 4th/7th-law milestones, each positioned by `frac` (its turn as a
	// fraction of the x-range) so they can be laid out in horizontal nation
	// bars above the chart — keeping the plot itself uncluttered.
	type RailEvent = {
		kind: "leader" | "law" | "tech";
		frac: number;
		iconUrl: string | null;
		num: string | null;
		color: string;
		tooltipHtml: string;
	};

	// Unit strength tiers worth flagging (displayed strength). Reaching the tech
	// that first fields a 5/6/8/10-str unit is a military power spike.
	const TARGET_STRENGTHS = new Set([5, 6, 8, 10]);

	// Naval is "relevant" only when a sea unit was actually built — otherwise
	// boat techs (Navigation, etc.) are noise and stay hidden.
	const navalRelevant = $derived(
		unitsProduced.some((u) => UNIT_STATS[u.unit_type]?.naval),
	);

	// Tooltip for a unit-tech-unlock marker: the tech + the qualifying units it
	// unlocks (with strength).
	function techEventTooltip(
		tech: string,
		turn: number,
		unlocked: { unitType: string; strength: number; naval: boolean }[],
		color: string,
	): string {
		const items = unlocked
			.map((u) => {
				const url = getSpritePath("units", u.unitType);
				const ic = url
					? `<img src="${url}" alt="" style="width:15px;height:15px"/>`
					: "";
				return `<div style="display:flex;align-items:center;gap:6px;color:#cfc9bd">${ic}<span>${formatEnum(u.unitType, "UNIT_")}</span><span style="color:#9b948a">str ${u.strength}${u.naval ? " · sea" : ""}</span></div>`;
			})
			.join("");
		return (
			`<div style="font-size:12px;line-height:1.55">` +
			`<div style="font-weight:700;color:${color}">${formatEnum(tech, "TECH_")} · T${turn}</div>` +
			`<div style="color:#9b948a;margin:3px 0 2px">Unlocks</div>` +
			items +
			`</div>`
		);
	}

	const eventRail = $derived.by(() => {
		const n = axisTurns.length;
		const fracOf = (turn: number): number => {
			if (n <= 1) return 0;
			const i = axisTurns.indexOf(nearest(axisTurns, turn));
			return i < 0 ? 0 : i / (n - 1);
		};
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
		const byPlayer = new Map<number, RailEvent[]>();

		for (const player of playerHistory) {
			const color = playerById.get(player.player_id)?.color ?? "#888888";
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
					frac: fracOf(turn),
					iconUrl: archKey ? getSpritePath("traits", archKey) : null,
					num: null,
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
						frac: fracOf(d.turn),
						iconUrl: getSpritePath("laws", d.law_name),
						num: String(d.law_count),
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
			const techHist = techDiscoveryHistory.find(
				(t) => t.player_id === player.player_id,
			);
			if (techHist) {
				for (const d of techHist.data) {
					if (d.tech_name == null) continue;
					const unlocked = Object.entries(UNIT_STATS)
						.filter(
							([, s]) =>
								s.tech === d.tech_name &&
								TARGET_STRENGTHS.has(s.strength) &&
								(navalRelevant || !s.naval),
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
						frac: fracOf(d.turn),
						iconUrl: getSpritePath("techs", d.tech_name),
						num: String(unlocked[0].strength),
						color,
						tooltipHtml: techEventTooltip(d.tech_name, d.turn, unlocked, color),
					});
				}
			}

			events.sort((a, b) => a.frac - b.frac);
			byPlayer.set(player.player_id, events);
		}

		return byPlayer;
	});

	// Hovering a rail icon shows its rich tooltip (via {@html}) and drops a
	// vertical guide line on the chart at that turn.
	let tip = $state<{ html: string; x: number; y: number } | null>(null);
	let highlight = $state<{ frac: number; color: string } | null>(null);
	function enterEvent(ev: RailEvent, e: MouseEvent) {
		tip = {
			html: ev.tooltipHtml,
			x: Math.min(e.clientX + 14, window.innerWidth - 300),
			y: Math.min(e.clientY + 14, window.innerHeight - 170),
		};
		highlight = { frac: ev.frac, color: ev.color };
	}
	function leaveEvent() {
		tip = null;
		highlight = null;
	}

	// Event-row order within each nation's group (only rows with events render).
	const RAIL_KINDS: RailEvent["kind"][] = ["leader", "law", "tech"];

	// Pixel insets matching the chart grid (grid.left / grid.right), so a rail
	// icon at fraction f — and the hover guide line — sit directly above the
	// matching turn on the plot. Also the plot's top/bottom insets for the line.
	const EVENT_RAIL_LEFT = 52;
	const EVENT_RAIL_RIGHT = 20;
	const PLOT_TOP = 48;
	const PLOT_BOTTOM = 46;

	// ─── Chart option ─────────────────────────────────────────────────
	const militaryChartOption = $derived<EChartsOption | null>(
		playerHistory
			? {
					...CHART_THEME,
					title: {
						...CHART_THEME.title,
						text: "Military Power",
					},
					legend: {
						show: false,
						data: playerHistory.map(
							(p) =>
								playerById.get(p.player_id)?.label ??
								formatEnum(p.nation, "NATION_"),
						),
						selected: chartFilter,
					},
					// Fixed plot insets (containLabel off) so the plot's left/right
					// edges are at known pixel offsets — the event bars above use the
					// same insets to line up with the turn axis. EVENT_RAIL_LEFT /
					// EVENT_RAIL_RIGHT below must match grid.left / grid.right.
					grid: {
						top: 48,
						left: 52,
						right: 20,
						bottom: 46,
						containLabel: false,
					},
					// Axis-trigger tooltip: hovering anywhere on the plot shows both
					// players' power at that turn. Event detail lives in the nation
					// bars above the chart, not on the plot.
					tooltip: { trigger: "axis" },
					xAxis: {
						type: "category",
						name: "Turn",
						nameLocation: "middle",
						nameGap: 28,
						// No end padding so turn → x maps linearly edge-to-edge,
						// keeping the event bars above aligned with the plot.
						boundaryGap: false,
						data: playerHistory[0]?.history.map((h) => h.turn) ?? [],
					},
					yAxis: {
						type: "value",
						name: "Military Power",
					},
					series: playerHistory.map((player) => {
						const rp = playerById.get(player.player_id);
						const color = rp?.color ?? "#888888";
						return {
							name: rp?.label ?? formatEnum(player.nation, "NATION_"),
							type: "line",
							data: player.history.map((h) => h.military_power),
							itemStyle: { color },
							lineStyle: { width: 2 },
							showSymbol: false,
							// owglick-style gradient fill under each curve.
							areaStyle: {
								color: {
									type: "linear",
									x: 0,
									y: 0,
									x2: 0,
									y2: 1,
									colorStops: [
										{ offset: 0, color: toRgba(color, 0.22) },
										{ offset: 1, color: toRgba(color, 0) },
									],
								},
							},
						};
					}),
				}
			: null,
	);

	// ─── Army composition donuts ──────────────────────────────────────
	// Build a class-composition donut (Infantry/Ranged/Cavalry/Siege/Naval)
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
			<!-- Chart, with a hover guide line overlaid at the event's turn. -->
			<div class="relative">
				<ChartContainer
					option={militaryChartOption}
					height="400px"
					title="Military Power"
				/>
				{#if highlight}
					<div
						class="pointer-events-none absolute z-10"
						style="left: calc({EVENT_RAIL_LEFT}px + {highlight.frac} * (100% - {EVENT_RAIL_LEFT +
							EVENT_RAIL_RIGHT}px)); top: {PLOT_TOP}px; bottom: {PLOT_BOTTOM}px; width: 0; border-left: 1px dashed {highlight.color};"
					></div>
				{/if}
			</div>

			<!-- Event rail: per-nation timeline below the plot (turn axis sits just
			     above). One row per event type so icons never overlap across types. -->
			<div class="mt-1 flex flex-col gap-1.5">
				{#each orderedPlayers as rp (rp.playerId)}
					{@const evs = eventRail.get(rp.playerId) ?? []}
					{@const kinds = RAIL_KINDS.filter((k) =>
						evs.some((e) => e.kind === k),
					)}
					{#if evs.length > 0}
						<div
							class="rounded py-0.5"
							style="background: {toRgba(rp?.color ?? '#888888', 0.1)};"
						>
							{#each kinds as kind, ki (kind)}
								<div class="relative h-6">
									{#if ki === 0}
										<div
											class="absolute inset-y-0 left-0 flex items-center pl-1.5"
											style="width: {EVENT_RAIL_LEFT}px;"
										>
											{#if rp?.nation}
												<SpriteIcon
													category="crests"
													value={rp.nation}
													size={18}
													alt={rp.label}
												/>
											{:else}
												<span
													class="truncate text-[10px] font-semibold"
													style="color: {rp?.color};">{rp?.label}</span
												>
											{/if}
										</div>
									{/if}
									{#each evs.filter((e) => e.kind === kind) as ev, i (i)}
										<div
											class="absolute top-1/2 flex cursor-default items-center"
											style="left: calc({EVENT_RAIL_LEFT}px + {ev.frac} * (100% - {EVENT_RAIL_LEFT +
												EVENT_RAIL_RIGHT}px)); transform: translate(-50%, -50%);"
											role="img"
											aria-label={ev.kind}
											onmousemove={(e) => enterEvent(ev, e)}
											onmouseleave={leaveEvent}
										>
											{#if ev.iconUrl}
												<img
													src={ev.iconUrl}
													alt=""
													style="width:18px;height:18px;"
												/>
											{:else}
												<span
													class="inline-block h-2.5 w-2.5 rounded-full"
													style="background: {ev.color};"
												></span>
											{/if}
											{#if ev.num}
												<span
													class="ml-0.5 font-mono text-[10px] font-bold leading-none text-bright"
													>{ev.num}</span
												>
											{/if}
										</div>
									{/each}
								</div>
							{/each}
						</div>
					{/if}
				{/each}
			</div>
		{/if}

		<!-- Standalone army-composition donuts: only for FFA / non-matchup
		     games (in a 1v1 the per-block donuts below take over). -->
		{#if armyPieCharts.length > 0 && !matchup}
			<div
				class="{militaryChartOption ? 'mt-4 ' : ''}grid gap-4"
				style="grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));"
			>
				{#each armyPieCharts as chart (chart.playerId)}
					<div class="overflow-hidden rounded-lg">
						<Chart option={chart.pieOption} height="200px" />
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
		<div class="grid gap-4 md:grid-cols-2">
			{#each buildBlocks as block (block.title)}
				<div class="flex flex-col gap-3">
					<BuildComparison
						title={block.title}
						sub={block.sub}
						a={block.a}
						b={block.b}
						aLabel={matchup[0].label}
						bLabel={matchup[1].label}
						ca={matchup[0].color}
						cb={matchup[1].color}
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

<!-- Floating tooltip for the event-rail icons. -->
{#if tip}
	<div
		class="pointer-events-none fixed z-50 max-w-[290px] rounded-md border border-border-subtle bg-surface-deep px-2.5 py-2 shadow-xl"
		style="left: {tip.x}px; top: {tip.y}px;"
	>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- internally-built, no user input -->
		{@html tip.html}
	</div>
{/if}
