<script lang="ts">
	// Economy tab — what the empire grew into, and what the workforce spent to
	// get there.
	//
	// The headline plot is one economy curve — GDP by default, then maintenance,
	// territory, cities or workers — with a DOM event rail below it, the Military
	// tab's pattern: the save carries no per-turn improvement history, so the
	// things that *can* be dated (foundings, wonder completions) annotate the
	// growth they caused. Under the plot the worker-turn ledger prices the
	// standing improvements, and the pivot table lists the inventory that bought.
	import type { ChartOption, ECharts } from "$lib/echarts";
	import type { CityStatistics } from "$lib/types/CityStatistics";
	import type { EventLog } from "$lib/types/EventLog";
	import type { YieldHistory } from "$lib/types/YieldHistory";
	import type { ImprovementData } from "$lib/types/ImprovementData";
	import type { PlayerUnitProduced } from "$lib/types/PlayerUnitProduced";
	import type { PlayerWonder } from "$lib/types/PlayerWonder";
	import type {
		PlayerResourceInfo,
		ProjectProducedInfo,
		TileOwnershipEntry,
		UnitInfo,
		YieldPriceEntry,
	} from "$lib/parser/types";
	import { IMPROVEMENT_BUILDS } from "$lib/generated/improvement-builds";
	import { CHART_THEME } from "$lib/config";
	import Chart from "$lib/Chart.svelte";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import { formatEnum, nationName } from "$lib/utils/formatting";
	import EventRail, {
		TOOLTIP_BORDER,
		TOOLTIP_MUTED,
		TOOLTIP_SURFACE,
		TOOLTIP_TEXT,
		type RailGroup,
		type RailMarker,
	} from "./EventRail.svelte";
	import BuildComparison from "./BuildComparison.svelte";
	import ImprovementPivotTable from "./ImprovementPivotTable.svelte";
	import SpriteIcon from "./SpriteIcon.svelte";
	import {
		WORKER_UNIT,
		YIELD_MAINTENANCE,
		calamities,
		citiesFoundedSeries,
		gdpSeries,
		nationalWealth,
		playerEconomies,
		type PlayerEconomy,
		territorySeries,
		workerSeries,
		yieldRateSeries,
		type EmpireSeries,
	} from "./economy";
	import { IMPROVEMENT_UNLOCK_COST } from "$lib/generated/science-yields";
	import {
		type BuildItem,
		comparisonRowKeys,
		type DetailPlayer,
		eventLogOwnedBy,
		ownedByPlayer,
		type TableState,
		familyCrestKey,
		familyForOwner,
		filledLineStyle,
		getSpritePath,
		improvementDisplayName,
		orderPlayersUploaderFirst,
		projectDisplayName,
	} from "./helpers";

	let {
		players,
		improvementData,
		allYields,
		yieldPrices = [],
		eventLogs,
		playerResources = [],
		projectsProduced = [],
		cityStatistics,
		playerWonders,
		unitsProduced,
		units = [],
		tileOwnershipHistory = [],
		totalTurns,
		userNation = null,
		tableState = $bindable<TableState>({
			search: "",
			sortColumn: "improvement",
			sortDirection: "asc",
			filters: [],
		}),
	}: {
		players: DetailPlayer[];
		improvementData: ImprovementData;
		allYields: YieldHistory[];
		// Game-level market prices per turn — the GDP basket's valuation. Sparse
		// (only turns where a price moved). Defaults to [] for legacy callers
		// (frozen web/ viewer), which drops the GDP view.
		yieldPrices?: YieldPriceEntry[];
		eventLogs: EventLog[];
		// End-of-game stockpiles — the National wealth panel. Defaults to [] for
		// legacy callers (frozen web/ viewer), which hides that panel.
		playerResources?: PlayerResourceInfo[];
		// Every project each player completed, whole-game counts. Present on
		// 2.13.0+ blobs only; the panel hides on older games rather than
		// implying nobody built projects.
		projectsProduced?: ProjectProducedInfo[];
		cityStatistics: CityStatistics;
		playerWonders: PlayerWonder[];
		unitsProduced: PlayerUnitProduced[];
		units?: UnitInfo[];
		// Sparse per-tile ownership transitions — the only territory-over-time
		// source in the blob. Defaults to [] for legacy callers (frozen web/
		// viewer), which drops the Territory view rather than the tab.
		tileOwnershipHistory?: TileOwnershipEntry[];
		totalTurns: number;
		userNation?: string | null;
		tableState?: TableState;
	} = $props();

	type ImprovementInfoRow = ImprovementData["improvements"][number];
	const orderedPlayers = $derived(
		orderPlayersUploaderFirst(players, userNation),
	);

	const economies = $derived(
		playerEconomies(
			orderedPlayers,
			improvementData.improvements,
			cityStatistics.cities,
			units,
		),
	);

	// ─── Headline chart ───────────────────────────────────────────────
	// Five views of the same question — how big is this economy — each carrying
	// a different blind spot. GDP leads: it's the only one that puts the whole
	// economy on a single axis.
	type EmpireMode = "gdp" | "maintenance" | "territory" | "cities" | "workers";

	const EMPIRE_MODES: { key: EmpireMode; label: string }[] = [
		{
			key: "gdp",
			label: "GDP",
		},
		{
			key: "maintenance",
			label: "Maintenance",
		},
		{
			key: "territory",
			label: "Territory",
		},
		{
			key: "cities",
			label: "Cities founded",
		},
		{
			key: "workers",
			label: "Workers built",
		},
	];

	let empireMode = $state<EmpireMode>("gdp");

	// Territory needs the ownership history, GDP the price series and workers
	// the ending roster; without those (legacy callers, older blobs) the view
	// drops rather than drawing a flat line, and the $effect below moves off it.
	const availableModes = $derived(
		EMPIRE_MODES.filter((m) => {
			if (m.key === "territory") return tileOwnershipHistory.length > 0;
			if (m.key === "gdp") return yieldPrices.length > 0;
			if (m.key === "workers") return units.length > 0;
			return true;
		}),
	);
	$effect(() => {
		if (!availableModes.some((m) => m.key === empireMode)) {
			empireMode = availableModes[0]?.key ?? "cities";
		}
	});

	const activeMode = $derived(
		EMPIRE_MODES.find((m) => m.key === empireMode) ?? EMPIRE_MODES[0],
	);

	// Kept separate from `empireSeries` so the GDP tooltip can reach each
	// turn's composition without every other view paying for it.
	const gdp = $derived(
		gdpSeries(allYields, yieldPrices, orderedPlayers, totalTurns),
	);

	const empireSeries = $derived.by<EmpireSeries[]>(() => {
		if (empireMode === "gdp") return gdp;
		if (empireMode === "maintenance") {
			return yieldRateSeries(
				allYields,
				YIELD_MAINTENANCE,
				orderedPlayers,
				totalTurns,
			);
		}
		if (empireMode === "territory") {
			return territorySeries(tileOwnershipHistory, orderedPlayers, totalTurns);
		}
		if (empireMode === "cities") {
			return citiesFoundedSeries(
				cityStatistics.cities,
				orderedPlayers,
				totalTurns,
			);
		}
		return workerSeries(units, orderedPlayers, totalTurns);
	});

	const AXIS_LABELS: Record<EmpireMode, string> = {
		gdp: "GDP (money/turn)",
		maintenance: "Maintenance (money/turn)",
		territory: "Tiles",
		cities: "Cities",
		workers: "Workers",
	};

	// GDP's tooltip is a small ledger rather than a one-liner: the basket is the
	// point, so each yield gets a row showing the income itself (+357 food) and
	// what that income is worth, with money — the unit the rest convert into —
	// last, then the total.
	const money = (value: number): string =>
		Math.round(value).toLocaleString("en-US");

	// Unit prices are single digits to low tens, so rounding them to whole
	// money would hide most of the movement the curve reacts to.
	const price = (value: number): string => value.toFixed(1);

	function gdpComposition(playerIndex: number, turn: number): string {
		const parts = gdp[playerIndex]?.breakdown[turn];
		if (parts == null || parts.components.length === 0) return "";
		const rows = parts.components
			.map((c) => {
				const icon = getSpritePath("yields", c.yieldType);
				const glyph =
					icon != null
						? `<img src="${icon}" alt="" style="width:13px;height:13px;vertical-align:-2px" />`
						: formatEnum(c.yieldType, "YIELD_");
				const sign = c.amount > 0 ? "+" : "";
				// Money buys nothing at a price — its face value is its worth. The
				// others carry the market rate they were valued at, which is what
				// moves the curve when production hasn't.
				const worth =
					c.price == null
						? "<td></td><td></td>"
						: `<td style="padding-left:8px;color:${TOOLTIP_MUTED}">worth ${money(c.value)}</td>` +
							`<td style="padding-left:6px;color:${TOOLTIP_MUTED}">@ ${price(c.price)} each</td>`;
				return (
					`<tr><td style="text-align:right;color:${TOOLTIP_TEXT}">${sign}${Math.round(c.amount)}</td>` +
					`<td style="padding-left:4px">${glyph}</td>${worth}</tr>`
				);
			})
			.join("");
		return (
			`<table style="font-size:11px;margin:3px 0 0 0;border-collapse:collapse">${rows}` +
			`<tr><td colspan="4" style="padding-top:3px;color:${TOOLTIP_MUTED}">` +
			`Total <b style="color:${TOOLTIP_TEXT}">${money(parts.total)}</b></td></tr></table>`
		);
	}

	const empireChartOption = $derived.by<ChartOption | null>(() => {
		const series = empireSeries
			.map((s) => {
				const player = orderedPlayers.find((p) => p.playerId === s.playerId);
				if (!player) return null;
				if (s.data.every((v) => v === 0)) return null;
				return {
					name: player.label,
					type: "line" as const,
					data: s.data.map((value, turn) => [turn, value]),
					itemStyle: { color: player.color },
					...filledLineStyle(player.color),
				};
			})
			.filter((s): s is NonNullable<typeof s> => s != null);
		if (series.length === 0) return null;

		return {
			...CHART_THEME,
			tooltip: {
				trigger: "axis",
				// The rail's dark surface, so the shared TOOLTIP_* text shades read
				// the same here as they do on the markers below the plot.
				backgroundColor: TOOLTIP_SURFACE,
				borderColor: TOOLTIP_BORDER,
				textStyle: { color: TOOLTIP_TEXT },
				formatter: (params: unknown) => {
					const arr = params as {
						marker: string;
						seriesName: string;
						value: [number, number];
					}[];
					if (arr.length === 0) return "";
					const turn = arr[0].value[0];
					const cells = arr
						.map((p) => ({
							marker: p.marker,
							name: p.seriesName,
							value: p.value[1],
							// The series list skips players with a flat-zero curve, so
							// resolve the composition by name rather than series index.
							playerIndex: orderedPlayers.findIndex(
								(op) => op.label === p.seriesName,
							),
						}))
						.sort((a, b) => b.value - a.value);
					// Side by side in GDP: the point is comparing two baskets, and
					// stacked ledgers put them a scroll apart.
					if (empireMode === "gdp") {
						const columns = cells
							.map(
								(r) =>
									`<td style="vertical-align:top;padding-right:18px">` +
									`<div>${r.marker}${r.name}</div>${gdpComposition(r.playerIndex, turn)}</td>`,
							)
							.join("");
						return `Turn ${turn}<table style="border-collapse:collapse"><tr>${columns}</tr></table>`;
					}
					const rows = cells
						.map((r) => `${r.marker}${r.name}: <b>${Math.round(r.value)}</b>`)
						.join("<br/>");
					return `Turn ${turn}<br/>${rows}`;
				},
			},
			grid: { left: 60, right: 40, top: 24, bottom: 60 },
			xAxis: {
				type: "value",
				name: "Turn",
				nameLocation: "middle",
				nameGap: 30,
				min: 0,
				max: totalTurns,
				minInterval: 1,
				splitLine: { show: false },
			},
			yAxis: {
				type: "value",
				name: AXIS_LABELS[empireMode],
				nameLocation: "middle",
				nameGap: 40,
				minInterval: 1,
			},
			series,
		} as ChartOption;
	});

	// Segmented-control tokens, matching the Techs tab's science view switch.
	const viewTriggerClass =
		"relative z-10 min-w-[9rem] cursor-pointer whitespace-nowrap px-3 py-1.5 text-center text-xs font-bold text-tan transition-colors";

	// ─── Annotation rail ──────────────────────────────────────────────
	// The live chart instance: rail markers are DOM, positioned by
	// convertToPixel, and `layoutTick` bumps on every re-layout so they track.
	let chart = $state<ECharts | null>(null);
	let layoutTick = $state(0);

	let highlight = $state<{ turn: number; color: string } | null>(null);
	const highlightLeft = $derived.by<number | null>(() => {
		const c = chart;
		const h = highlight;
		// `layoutTick < 0` is always false but reads the signal to track re-layout.
		if (!c || !h || layoutTick < 0) return null;
		return c.convertToPixel({ xAxisIndex: 0 }, h.turn) as number;
	});

	function tooltip(title: string, sub: string): string {
		return (
			`<div style="color:${TOOLTIP_TEXT};font-weight:700">${title}</div>` +
			`<div style="color:${TOOLTIP_MUTED};font-size:11px">${sub}</div>`
		);
	}

	const gameCalamities = $derived(calamities(eventLogs));

	const wealth = $derived(
		nationalWealth(playerResources, yieldPrices, orderedPlayers, totalTurns),
	);

	// Three rows per nation: cities founded, wonders completed, calamities — the
	// economy milestones the save actually timestamps. There is no per-turn
	// improvement history in the blob, so these are what can annotate the curve.
	const railGroups = $derived.by<RailGroup[]>(() =>
		orderedPlayers
			.map((player) => {
				// Each city marker wears its family crest (the family during the
				// FOUNDER's tenure — a captured city's current family is the
				// conqueror's), and the tooltip counts the founding ordinals:
				// this player's Nth city of that family, and Nth city overall.
				const founded = cityStatistics.cities
					.filter((c) => c.first_owner_player_xml_id === player.playerId)
					.sort((a, b) => a.founded_turn - b.founded_turn);
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
				const familySeen = new Map<string, number>();
				const cityMarkers: RailMarker[] = founded.map((c, i) => {
					const { family, familyClass } = familyForOwner(c, player.playerId);
					const crest = familyCrestKey(family, familyClass);
					const lines = [`Founded turn ${c.founded_turn}`];
					if (familyClass) {
						const nthOfFamily = (familySeen.get(familyClass) ?? 0) + 1;
						familySeen.set(familyClass, nthOfFamily);
						lines.push(
							`${formatEnum(familyClass, "FAMILYCLASS_")} city #${nthOfFamily}`,
						);
					}
					lines.push(`Overall city #${i + 1}`);
					const crestUrl = crest ? getSpritePath("crests", crest) : null;
					const title =
						(crestUrl
							? `<img src="${crestUrl}" alt="" style="display:inline;width:14px;height:14px;vertical-align:-2px;margin-right:3px"/>`
							: "") + formatEnum(c.city_name, "CITYNAME_");
					return {
						turn: c.founded_turn,
						iconCategory: "crests" as const,
						iconValue: crest,
						color: player.color,
						tooltipHtml: tooltip(title, lines.join("<br/>")),
					};
				});
				const wonderMarkers: RailMarker[] = playerWonders
					.filter((w) => w.player_id === player.playerId)
					.sort((a, b) => a.completed_turn - b.completed_turn)
					.map((w) => ({
						turn: w.completed_turn,
						iconCategory: "improvements" as const,
						iconValue: w.wonder,
						color: player.color,
						tooltipHtml: tooltip(
							improvementDisplayName(w.wonder),
							`Completed turn ${w.completed_turn}`,
						),
					}));
				// Every event log comes off a Player node, so a calamity's owner
				// set names exactly the realms that logged it — there is no
				// "game-wide, so show it everywhere" case to fall back on. A
				// plague the whole world caught carries every player and still
				// lands on every band.
				const calamityMarkers: RailMarker[] = gameCalamities
					.filter((c) => eventLogOwnedBy(c.playerXmlIds, c.playerName, player))
					.map((c) => ({
						turn: c.turn,
						iconCategory: "icons" as const,
						iconValue: "PENDING_CRITICAL",
						color: player.color,
						tooltipHtml: tooltip(
							formatEnum(c.occurrence, "OCCURRENCE_"),
							c.description,
						),
					}));
				const rows = [
					{ kind: "city", markers: cityMarkers },
					{ kind: "wonder", markers: wonderMarkers },
					{ kind: "calamity", markers: calamityMarkers },
				].filter((r) => r.markers.length > 0);
				return { player, rows };
			})
			.filter((g) => g.rows.length > 0),
	);

	// ─── Worker-turn ledger ───────────────────────────────────────────
	// Workers the player trained over the whole game, from the per-player
	// production counts. Compared against the surviving roster it says how much
	// of the workforce is missing from the curve above.
	const workersProduced = $derived(
		new Map(
			unitsProduced
				.filter((u) => u.unit_type === WORKER_UNIT)
				.map((u) => [u.player_id, u.count]),
		),
	);

	// The caveats behind the two headline numbers, only the ones that apply:
	// workers that didn't survive, workers taken off someone else, and standing
	// improvements the ledger charged nobody for.
	function workforceNote(eco: PlayerEconomy): string {
		const produced = workersProduced.get(eco.player.playerId);
		const parts = [
			produced != null && produced !== eco.workersBuilt
				? `${eco.workersBuilt} workers alive at the end, of ${produced} built`
				: `${eco.workersBuilt} workers built`,
		];
		if (eco.workersCaptured > 0) {
			parts.push(`${eco.workersCaptured} captured off an opponent`);
		}
		if (eco.freeCount > 0) {
			parts.push(`${eco.freeCount} improvements taken, not built`);
		}
		return parts.join(" · ");
	}

	// ─── Side-by-side comparisons ─────────────────────────────────────
	// The Military tab's diverging-bar module, pointed at what this tab counts.
	// One panel per kind — rural / urban — because that split is the strategic
	// axis: a wide farm empire and a tall urban one show up as different
	// blocks rather than one undifferentiated list. 1v1 like the
	// Military panels, so it renders only for a two-sided game. (Specialists
	// get the same treatment on the Specialists tab, next to the coverage
	// numbers they explain.)
	const matchup = $derived(orderedPlayers.length === 2 ? orderedPlayers : null);

	type ComparisonPanel = {
		label: string;
		keys: string[];
		items: BuildItem[][];
	};

	function panels(
		order: string[],
		// eslint-disable-next-line no-unused-vars -- callback type signature
		bucket: (improvement: ImprovementInfoRow) => string | null,
		// eslint-disable-next-line no-unused-vars -- callback type signature
		keyOf: (improvement: ImprovementInfoRow) => string | null,
		// Row order. Null sorts by the combined total, biggest first — right when
		// the panel is measuring effort rather than listing a catalogue.
		// eslint-disable-next-line no-unused-vars -- callback type signature
		sortKey: ((key: string) => number) | null,
		// What each improvement adds to its row — one when counting them, its
		// build cost when the panel is measuring worker-turns.
		// eslint-disable-next-line no-unused-vars -- callback type signature
		weightOf: (improvement: ImprovementInfoRow) => number = () => 1,
	): ComparisonPanel[] {
		const sides = orderedPlayers.map((player) => {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
			const counts = new Map<string, Map<string, number>>();
			for (const imp of ownedByPlayer(
				improvementData.improvements,
				player,
				(x) => x.owner_player_xml_id,
				(x) => x.nation,
			)) {
				const group = bucket(imp);
				const key = keyOf(imp);
				if (group == null || key == null) continue;
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
				const rows = counts.get(group) ?? new Map<string, number>();
				rows.set(key, (rows.get(key) ?? 0) + weightOf(imp));
				counts.set(group, rows);
			}
			return counts;
		});
		return order
			.map((group) => {
				// Raw per-side rows: BuildComparison re-aggregates these and gap-fills
				// against the shared `keys`, so a side that lacks a key just omits it.
				const items = sides.map((s) =>
					[...(s.get(group)?.entries() ?? [])].map(([key, count]) => ({
						key,
						count,
					})),
				);
				const total = (key: string) =>
					sides.reduce((sum, s) => sum + (s.get(group)?.get(key) ?? 0), 0);
				// Ties break on the displayed name — the order every other comparison
				// panel already uses (MilitaryTab's shared union, and BuildComparison's
				// own default) — so equal rows don't fall back on whichever side
				// happened to mention them first.
				const byName = (a: string, b: string) =>
					improvementDisplayName(a).localeCompare(improvementDisplayName(b));
				const keys = comparisonRowKeys(items, (a, b) =>
					sortKey == null
						? total(b) - total(a) || byName(a, b)
						: sortKey(a) - sortKey(b) || byName(a, b),
				);
				return { label: group, keys, items };
			})
			.filter((p) => p.keys.length > 0);
	}

	const improvementPanels = $derived(
		panels(
			["rural", "urban"],
			(imp) => IMPROVEMENT_BUILDS[imp.improvement]?.kind ?? null,
			(imp) => (IMPROVEMENT_BUILDS[imp.improvement] ? imp.improvement : null),
			(key) => IMPROVEMENT_UNLOCK_COST[key] ?? 0,
		),
	);

	// The same rows as the improvement comparison, priced in worker-turns
	// instead of counted — so read after the counts, it says which of those
	// builds actually took the time. Sorted by total effort rather than unlock
	// cost, since that's the question this panel answers.
	const workerTurnPanels = $derived(
		panels(
			["rural", "urban"],
			(imp) => IMPROVEMENT_BUILDS[imp.improvement]?.kind ?? null,
			(imp) => (IMPROVEMENT_BUILDS[imp.improvement] ? imp.improvement : null),
			null,
			(imp) => IMPROVEMENT_BUILDS[imp.improvement]?.turns ?? 0,
		),
	);

	// ─── Projects ─────────────────────────────────────────────────────
	// Projects are the third thing a city builds besides units and (via
	// workers) improvements, and the save's ProjectsProduced map is the
	// whole-game record. Rows are keyed by PROJECT_* zType.
	// Tiers stay distinct rows here (Council I/II/III are separate
	// accomplishments), which is why the labels come from the baked
	// project-name table — formatEnum alone strips the trailing digit and
	// collapses the whole line onto one name.

	// Per-nation project counts — the shared source for both surfaces below:
	// the duel's comparison panel and the per-nation cards that stand in for it
	// when the game has any other number of players.
	const projectsByPlayer = $derived(
		orderedPlayers.map((player) => {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, not reactive state
			const counts = new Map<string, number>();
			for (const row of projectsProduced) {
				if (row.player_xml_id !== player.playerId) continue;
				counts.set(row.project, (counts.get(row.project) ?? 0) + row.count);
			}
			return counts;
		}),
	);

	// Raw per-nation rows: BuildComparison re-aggregates these and gap-fills
	// them against whatever `keys` it was handed, so a nation that built none
	// of a project just omits it here.
	const projectItems = $derived<BuildItem[][]>(
		projectsByPlayer.map((counts) =>
			[...counts].map(([key, count]) => ({ key, count })),
		),
	);

	// The duel panel's row order, and the union every project in the game
	// appears in. One flat list — projects have no rural/urban axis to split
	// on. Same ordering the improvement panels use: biggest total first, ties
	// on the displayed name rather than the raw zType, which sorts the
	// underscore before a letter and would put Councillor ahead of Council 1.
	const projectKeys = $derived.by(() => {
		const total = (key: string) =>
			projectsByPlayer.reduce((sum, m) => sum + (m.get(key) ?? 0), 0);
		return comparisonRowKeys(
			projectItems,
			(a, b) =>
				total(b) - total(a) ||
				projectDisplayName(a).localeCompare(projectDisplayName(b)),
		);
	});

	// False on 2.12.0 and older blobs, which carry no ProjectsProduced at all,
	// and on a game where nobody finished one. Both hide the surfaces below
	// rather than showing zeroes that would imply nobody built projects.
	const hasProjects = $derived(projectKeys.length > 0);

	// One bar scale across every nation's ledger, so a bar length means the
	// same thing on each card — the busiest single nation-and-project cell in
	// the game. Scaling each card to its own longest row instead would draw a
	// nation with two projects exactly like one with twenty.
	const projectMax = $derived(
		Math.max(
			1,
			...projectsByPlayer.map((counts) => Math.max(0, ...counts.values())),
		),
	);

	// Project names run far longer than the unit and improvement names the
	// panel's 110px column was cut for ("Codex Of Highland Wisdom"), so size the
	// column off the longest name in the game instead of clipping it. One width
	// for every panel, so the bars keep the shared scale above meaningful — a
	// per-card column would hand each nation a different amount of bar. The
	// 20px covers the icon slot and its gap, which share the column.
	const projectLabelWidth = $derived(
		`calc(${Math.max(0, ...projectKeys.map((key) => projectDisplayName(key).length))}ch + 20px)`,
	);

	// Each nation's ledger lists only what that nation built, biggest first.
	// Handing every card the shared row order instead would pad it with a blank
	// row for each project the other nations built and it didn't.
	const projectLedgers = $derived(
		orderedPlayers.map((player, i) => ({
			player,
			items: projectItems[i],
			keys: comparisonRowKeys([projectItems[i]], (a, b) => {
				const counts = projectsByPlayer[i];
				return (
					(counts.get(b) ?? 0) - (counts.get(a) ?? 0) ||
					projectDisplayName(a).localeCompare(projectDisplayName(b))
				);
			}),
		})),
	);

	// Wonders have their own tab; the Built panels carry only worker economy.
	const PANEL_LABELS: Record<string, string> = {
		rural: "Rural",
		urban: "Urban",
	};
</script>

<div
	class="mb-4 rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<!-- Empire view switch: the economy curves the blob can answer, each with
	     its own blind spot. It sits outside the plot's guard so a view that
	     turns out to hold nothing leaves the user a way back to one that
	     doesn't. -->
	<div
		class="relative mb-1 grid w-fit overflow-hidden rounded-lg border-2 border-surface-sunken"
		style="background-color: rgb(var(--color-surface)); grid-template-columns: repeat({availableModes.length}, minmax(0, 1fr));"
		role="group"
		aria-label="Empire chart view"
	>
		<div
			class="pointer-events-none absolute inset-y-0 left-0 transition-transform duration-200 ease-out"
			style:width="{100 / availableModes.length}%"
			style:background-color="rgb(var(--color-surface-raised))"
			style:transform="translateX({availableModes.findIndex(
				(m) => m.key === empireMode,
			) * 100}%)"
		></div>
		{#each availableModes as mode (mode.key)}
			<button
				type="button"
				class={viewTriggerClass}
				aria-pressed={empireMode === mode.key}
				onclick={() => (empireMode = mode.key)}
			>
				{mode.label}
			</button>
		{/each}
	</div>

	{#if !empireChartOption}
		<p class="p-8 text-center italic text-tan">
			No data for {activeMode.label}
		</p>
	{:else if railGroups.length > 0}
		<!-- Plot (Chart, not ChartContainer, so we hold the instance) with a DOM
		     rail below — cities founded and wonders completed, each marker at its
		     true turn-x via convertToPixel. -->
		<div class="relative">
			<Chart
				option={empireChartOption}
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
			option={empireChartOption}
			height="400px"
			title={activeMode.label}
		/>
	{/if}
</div>

{#if wealth.some((w) => w.components.length > 0)}
	<section class="mb-6">
		<h2 class="mb-1 text-lg font-bold text-bright">National wealth</h2>
		<!-- National wealth: the stockpiles at the final turn, priced. A snapshot,
		     not a curve — the save records no stockpile history. -->
		<div class="mb-4 grid gap-3 sm:grid-cols-2">
			{#each wealth as w (w.player.playerId)}
				<div
					class="rounded-lg p-4"
					style="background-color: rgb(var(--color-surface));"
				>
					<div class="mb-2 flex items-baseline justify-between gap-2">
						<span class="flex items-center gap-2">
							{#if w.player.nation}
								<SpriteIcon
									category="crests"
									value={w.player.nation}
									size={18}
									alt={nationName(w.player.nation)}
								/>
							{/if}
							<span class="font-bold" style="color: {w.player.color};"
								>{w.player.label}</span
							>
						</span>
						<span class="text-xs text-tan">national wealth</span>
					</div>
					<div class="text-2xl font-bold text-white">{money(w.total)}</div>
					<div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-tan">
						{#each w.components as c (c.yieldType)}
							<span class="inline-flex items-center gap-1">
								<SpriteIcon
									category="yields"
									value={c.yieldType}
									size={13}
									alt={formatEnum(c.yieldType, "YIELD_")}
								/>
								<span class="font-bold text-white">{money(c.amount)}</span>
								{#if c.price != null}<span>({money(c.value)})</span>{/if}
							</span>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</section>
{/if}

<section class="mb-6">
	<h2 class="mb-1 text-lg font-bold text-bright">Built</h2>
	<!-- Per-player ledger headline: what the workforce cost and what it bought. -->
	<div class="mb-4 grid gap-3 sm:grid-cols-2">
		{#each economies as eco (eco.player.playerId)}
			<div
				class="rounded-lg p-4"
				style="background-color: rgb(var(--color-surface));"
			>
				<div class="mb-3 flex items-center gap-2">
					{#if eco.player.nation}
						<SpriteIcon
							category="crests"
							value={eco.player.nation}
							size={18}
							alt={nationName(eco.player.nation)}
						/>
					{/if}
					<span class="font-bold" style="color: {eco.player.color};"
						>{eco.player.label}</span
					>
				</div>
				<div class="grid grid-cols-4 gap-3 text-sm">
					<div>
						<div class="text-2xl font-bold text-white">{eco.workerTurns}</div>
						<div class="text-xs text-tan">worker-turns</div>
					</div>
					<div>
						<div class="text-2xl font-bold text-white">{eco.builtCount}</div>
						<div class="text-xs text-tan">improvements</div>
					</div>
					<div>
						<div class="text-2xl font-bold text-white">
							{eco.countByKind.urban}
						</div>
						<div class="text-xs text-tan">urban</div>
					</div>
					<div>
						<div class="text-2xl font-bold text-white">
							{eco.countByKind.wonder}
						</div>
						<div class="text-xs text-tan">wonders</div>
					</div>
				</div>
				<p class="mt-2 text-xs italic text-tan">{workforceNote(eco)}</p>
			</div>
		{/each}
	</div>

	{#if !matchup && hasProjects}
		<!-- Projects have no pivot table below to fall back on the way
		     improvements do, so without these the data would parse, ship and
		     then show nowhere in a game that isn't a duel. One ledger panel
		     per nation, sharing a bar scale so the cards read against each
		     other rather than each alone. -->
		<div
			class="rounded-lg p-4"
			style="background-color: rgb(var(--color-surface));"
		>
			<h3 class="mb-3 text-base font-bold text-tan">Projects completed</h3>
			<!-- Columns rather than a grid: nations build wildly different
			     numbers of projects, and grid rows are as tall as their tallest
			     cell, so a short nation beside a long one leaves the gap its
			     neighbour's rows opened. Column flow packs each ledger under the
			     last instead. break-inside-avoid keeps one nation whole. -->
			<div class="gap-3 lg:columns-2">
				{#each projectLedgers as ledger (ledger.player.playerId)}
					<div class="mb-3 flex break-inside-avoid flex-col gap-1.5">
						<div class="flex items-center gap-2">
							{#if ledger.player.nation}
								<SpriteIcon
									category="crests"
									value={ledger.player.nation}
									size={16}
									alt={nationName(ledger.player.nation)}
								/>
							{/if}
							<span
								class="truncate text-xs font-bold"
								style="color: {ledger.player.color};"
								>{ledger.player.label}</span
							>
						</div>
						<BuildComparison
							title="All projects"
							a={ledger.items}
							ca={ledger.player.color}
							keys={ledger.keys}
							max={projectMax}
							labelWidth={projectLabelWidth}
							iconCategory="projects"
							labelOf={projectDisplayName}
						/>
					</div>
				{/each}
			</div>
		</div>
	{/if}
	{#if matchup}
		<!-- Counts beside cost: two columns read better than one full-width panel,
		     and the same rows sit at the same height in both. -->
		<div class="grid items-start gap-4 lg:grid-cols-2">
			<div
				class="rounded-lg p-4"
				style="background-color: rgb(var(--color-surface));"
			>
				<h3 class="mb-3 text-base font-bold text-tan">Improvements built</h3>
				<div class="flex flex-col gap-3">
					{#each improvementPanels as panel (panel.label)}
						<BuildComparison
							title={PANEL_LABELS[panel.label]}
							a={panel.items[0]}
							b={panel.items[1]}
							ca={matchup[0].color}
							cb={matchup[1].color}
							keys={panel.keys}
							iconCategory="improvements"
							labelOf={improvementDisplayName}
							showDiff
						/>
					{/each}
				</div>
			</div>
			<div
				class="rounded-lg p-4"
				style="background-color: rgb(var(--color-surface));"
			>
				<h3 class="mb-3 text-base font-bold text-tan">Worker-turns spent</h3>
				<div class="flex flex-col gap-3">
					{#each workerTurnPanels as panel (panel.label)}
						<BuildComparison
							title={PANEL_LABELS[panel.label]}
							a={panel.items[0]}
							b={panel.items[1]}
							ca={matchup[0].color}
							cb={matchup[1].color}
							keys={panel.keys}
							iconCategory="improvements"
							labelOf={improvementDisplayName}
							showDiff
						/>
					{/each}
				</div>
			</div>
			{#if hasProjects}
				<div
					class="rounded-lg p-4"
					style="background-color: rgb(var(--color-surface));"
				>
					<h3 class="mb-3 text-base font-bold text-tan">Projects completed</h3>
					<BuildComparison
						title="All projects"
						a={projectItems[0]}
						b={projectItems[1]}
						ca={matchup[0].color}
						cb={matchup[1].color}
						keys={projectKeys}
						labelWidth={projectLabelWidth}
						iconCategory="projects"
						labelOf={projectDisplayName}
						showDiff
					/>
				</div>
			{/if}
		</div>
	{/if}
</section>

<section class="mb-6">
	<h2 class="mb-1 text-lg font-bold text-bright">Every improvement</h2>
	<ImprovementPivotTable {players} {improvementData} bind:tableState />
</section>
