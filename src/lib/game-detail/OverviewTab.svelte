<script lang="ts">
	import type { GameDetails } from "$lib/types/GameDetails";
	import type { PlayerHistory } from "$lib/types/PlayerHistory";
	import type { YieldHistory } from "$lib/types/YieldHistory";
	import type { PlayerTech } from "$lib/types/PlayerTech";
	import type { PlayerLaw } from "$lib/types/PlayerLaw";
	import type { PlayerUnitProduced } from "$lib/types/PlayerUnitProduced";
	import type { CityStatistics } from "$lib/types/CityStatistics";
	import type { ImprovementData } from "$lib/types/ImprovementData";
	import type { GameReligion } from "$lib/types/GameReligion";
	import type { PlayerWonder } from "$lib/types/PlayerWonder";
	import type { MapTile } from "$lib/types/MapTile";
	import type { TileOwnershipEntry } from "$lib/parser/types";
	import type { ChartOption } from "$lib/echarts";
	import ChartContainer from "$lib/ChartContainer.svelte";
	import { CHART_THEME } from "$lib/config";
	import {
		TOOLTIP_BORDER,
		TOOLTIP_MUTED,
		TOOLTIP_SURFACE,
		TOOLTIP_TEXT,
	} from "./EventRail.svelte";
	import { momentumCurve, type MomentumCurve } from "./momentum";
	import { formatEnum } from "$lib/utils/formatting";
	import {
		type PlayerSummary,
		type SpriteCategory,
		type UnitClass,
		type DetailPlayer,
		ownedByPlayer,
		findByPlayer,
		classifyUnit,
		UNIT_CLASS_COLORS,
		improvementDisplayName,
	} from "./helpers";
	import SpriteIcon from "./SpriteIcon.svelte";

	let {
		gameDetails,
		players,
		playerHistory,
		allYields,
		completedTechs,
		currentLaws,
		unitsProduced,
		cityStatistics,
		victoryPointsEnabled,
		improvementData,
		gameReligions,
		playerWonders,
		staticMapTiles = null,
		tileOwnershipHistory = [],
		userNation = null,
		userDisplayName = null,
	}: {
		gameDetails: GameDetails;
		players: DetailPlayer[];
		playerHistory: PlayerHistory[];
		allYields: YieldHistory[];
		completedTechs: PlayerTech[];
		currentLaws: PlayerLaw[];
		unitsProduced: PlayerUnitProduced[];
		cityStatistics: CityStatistics;
		victoryPointsEnabled: boolean;
		improvementData: ImprovementData;
		gameReligions: GameReligion[];
		playerWonders: PlayerWonder[];
		// End-state map tiles for the momentum chart's city reconstruction —
		// deliberately NOT the turn-slider's reconstructed tiles, whose
		// properties reflect the selected turn. Null for legacy callers.
		staticMapTiles?: MapTile[] | null;
		tileOwnershipHistory?: TileOwnershipEntry[];
		// Uploader's picked nation (cloud-only). When set, drives the
		// save-owner flag below; otherwise falls back to the alphabetical-
		// first-human heuristic (correct for single-human legacy shares
		// from the frozen web/ viewer, wrong for multi-human cloud saves).
		userNation?: string | null;
		// Uploader's Discord display_name (cloud-only). Used as the player
		// label for the uploader's nation card when the save itself has no
		// leader name — Old World writes "" for unnamed solo games.
		userDisplayName?: string | null;
	} = $props();

	const UNIT_CLASS_ABBREV: Record<UnitClass, string> = {
		Infantry: "Inf",
		Ranged: "Ran",
		Mounted: "Mount",
		Siege: "Siege",
		Water: "Water",
	};

	// ─── Player summaries with army composition ──────────────────────
	type ArmySlice = { unitClass: UnitClass; count: number; pct: number };

	type PlayerReligion = { religion_name: string; founded_turn: number | null };

	type PlayerWonderEntry = { wonder: string; completed_turn: number };

	type PlayerOverview = PlayerSummary & {
		color: string;
		army: ArmySlice[];
		religions: PlayerReligion[];
		wonders: PlayerWonderEntry[];
	};

	// Exactly one player is the save owner. In a mirror match `userNation`
	// can't disambiguate two same-nation players, so pick the first matching
	// human (or the first human when userNation is absent — the legacy path).
	const saveOwnerId = $derived(
		(userNation != null
			? players.find((p) => p.nation === userNation)
			: players.find((p) => p.is_human)
		)?.playerId ?? null,
	);

	const playerOverviews = $derived<PlayerOverview[]>(
		players
			.map((p) => {
				const ph = findByPlayer(
					playerHistory,
					p,
					(h) => h.player_id,
					(h) => h.nation,
				);
				const lastPoint = ph?.history.at(-1);

				const playerUnits = ownedByPlayer(
					unitsProduced,
					p,
					(u) => u.player_id,
					(u) => u.nation,
				);
				const classCounts: Partial<Record<UnitClass, number>> = {};
				let totalUnits = 0;
				for (const u of playerUnits) {
					const cls = classifyUnit(u.unit_type);
					if (cls == null) continue;
					classCounts[cls] = (classCounts[cls] ?? 0) + u.count;
					totalUnits += u.count;
				}
				const army: ArmySlice[] = (
					Object.entries(classCounts) as [UnitClass, number][]
				)
					.filter(([, count]) => count > 0)
					.map(([unitClass, count]) => ({
						unitClass,
						count,
						pct: totalUnits > 0 ? Math.round((count / totalUnits) * 100) : 0,
					}))
					.sort((a, b) => b.count - a.count);

				const religions: PlayerReligion[] = ownedByPlayer(
					gameReligions,
					p,
					(r) => r.founder_player_xml_id,
					(r) => r.founder_nation,
				).map((r) => ({
					religion_name: r.religion_name,
					founded_turn: r.founded_turn,
				}));

				const wonders: PlayerWonderEntry[] = ownedByPlayer(
					playerWonders,
					p,
					(w) => w.player_id,
					(w) => w.nation,
				).map((w) => ({ wonder: w.wonder, completed_turn: w.completed_turn }));

				const isSaveOwner = p.playerId === saveOwnerId;
				// Fall back to the uploader's Discord display_name on the
				// save-owner card when Old World wrote no leader name (common
				// for solo games where the player didn't customize names).
				const playerName =
					isSaveOwner && !p.player_name && userDisplayName
						? userDisplayName
						: p.player_name;
				return {
					playerId: p.playerId,
					playerName,
					nation: p.nation,
					isHuman: p.is_human,
					isSaveOwner,
					isWinner:
						gameDetails.winner_player_id != null &&
						p.playerId === gameDetails.winner_player_id,
					finalVP: lastPoint?.points ?? null,
					finalMilitary: lastPoint?.military_power ?? null,
					cityCount: ownedByPlayer(
						cityStatistics.cities,
						p,
						(c) => c.owner_player_xml_id,
						(c) => c.owner_nation,
					).length,
					techCount: ownedByPlayer(
						completedTechs,
						p,
						(t) => t.player_id,
						(t) => t.nation,
					).length,
					lawCount: ownedByPlayer(
						currentLaws,
						p,
						(l) => l.player_id,
						(l) => l.nation,
					).length,
					unitsTotal: totalUnits,
					religion: p.state_religion,
					color: p.color,
					religions,
					wonders,
					army,
				};
			})
			.sort((a, b) => {
				// Save owner first, then other humans alphabetically, then AI alphabetically
				if (a.isSaveOwner !== b.isSaveOwner) return a.isSaveOwner ? -1 : 1;
				if (a.isHuman !== b.isHuman) return a.isHuman ? -1 : 1;
				const aNation = formatEnum(a.nation, "NATION_");
				const bNation = formatEnum(b.nation, "NATION_");
				return aNation.localeCompare(bNation);
			}),
	);

	// ─── Key metrics: yield comparison bars ──────────────────────────
	type MetricSprite = { category: SpriteCategory; value: string };

	type MetricBar = {
		label: string;
		sprite: MetricSprite | null;
		players: {
			playerId: number;
			label: string;
			nation: string | null;
			value: number;
			color: string;
		}[];
		maxValue: number;
	};

	function buildMetric(
		label: string,
		getValue: (player: DetailPlayer) => number, // eslint-disable-line no-unused-vars
		sprite: MetricSprite | null = null,
	): MetricBar {
		const bars = players
			.map((p) => ({
				playerId: p.playerId,
				label: p.label,
				nation: p.nation,
				value: getValue(p),
				color: p.color,
			}))
			// Omit zero-value players: an empty bar beside a "0" reads as a render
			// glitch. Negatives are kept (clamped to an empty bar, real value shown).
			.filter((p) => p.value !== 0)
			.sort((a, b) => b.value - a.value);
		const maxVal = Math.max(...bars.map((p) => p.value), 1);
		return { label, sprite, players: bars, maxValue: maxVal };
	}

	function yieldMetric(yieldType: string, label: string): MetricBar {
		return buildMetric(
			label,
			(player) => {
				const yieldData = findByPlayer(
					allYields.filter((y) => y.yield_type === yieldType),
					player,
					(y) => y.player_id,
					(y) => y.nation,
				);
				return Math.round(yieldData?.data.at(-1)?.rate ?? 0);
			},
			{ category: "yields", value: yieldType },
		);
	}

	// Column 1: Victory Points, Orders, Military, Training
	const metricsCol1 = $derived<MetricBar[]>([
		...(victoryPointsEnabled
			? [
					buildMetric(
						"Victory Points",
						(player) => {
							const ph = findByPlayer(
								playerHistory,
								player,
								(h) => h.player_id,
								(h) => h.nation,
							);
							return ph?.history.at(-1)?.points ?? 0;
						},
						{ category: "icons", value: "VICTORY_NORMAL" },
					),
				]
			: []),
		yieldMetric("YIELD_ORDERS", "Orders"),
		buildMetric(
			"Military",
			(player) => {
				const ph = findByPlayer(
					playerHistory,
					player,
					(h) => h.player_id,
					(h) => h.nation,
				);
				return ph?.history.at(-1)?.military_power ?? 0;
			},
			{ category: "icons", value: "MILITARY" },
		),
		yieldMetric("YIELD_TRAINING", "Training"),
	]);

	// Column 2: Science, Civics, Money, Improvements
	const metricsCol2 = $derived<MetricBar[]>([
		yieldMetric("YIELD_SCIENCE", "Science"),
		yieldMetric("YIELD_CIVICS", "Civics"),
		yieldMetric("YIELD_MONEY", "Money"),
		buildMetric(
			"Improvements",
			(player) =>
				ownedByPlayer(
					improvementData.improvements,
					player,
					(imp) => imp.owner_player_xml_id,
					(imp) => imp.nation,
				).length,
			{ category: "icons", value: "IMPROVEMENT_FINISHED" },
		),
	]);

	// Pair the two columns row-major so each left panel renders beside its right
	// counterpart in a shared grid row (equal height, aligned tops). Panels can
	// now differ in row count (zero-value players are dropped), so two
	// independent column stacks would drift out of vertical alignment. Columns
	// may also differ in length (Victory Points is conditional), so a slot can be
	// undefined — the markup renders a spacer to hold the column.
	const metricRows = $derived(
		Array.from(
			{ length: Math.max(metricsCol1.length, metricsCol2.length) },
			(_, i) => {
				const left: MetricBar | undefined = metricsCol1[i];
				const right: MetricBar | undefined = metricsCol2[i];
				return { left, right, key: left?.label ?? right?.label ?? String(i) };
			},
		),
	);

	function formatValue(value: number): string {
		if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
		return value.toString();
	}

	// ─── Momentum ─────────────────────────────────────────────────────
	// The fitted win-probability curve for duels: who was winning, turn by
	// turn, with the exact decomposition of why in the tooltip. Retrospective
	// by construction (weights fitted on the corpus, buckets keyed on the
	// final turn) — worded as a reading of the match, never a forecast.
	const duelists = $derived.by(() => {
		const humans = players.filter((p) => p.is_human);
		if (humans.length !== 2) return null;
		// Uploader-first, so the plotted line is "my side" when there is one.
		const ordered = [...humans].sort(
			(a, b) =>
				(a.nation === userNation ? 0 : 1) - (b.nation === userNation ? 0 : 1),
		);
		return ordered as [DetailPlayer, DetailPlayer];
	});

	const momentum = $derived.by<MomentumCurve | null>(() => {
		const duo = duelists;
		if (!duo || !staticMapTiles || staticMapTiles.length === 0) return null;
		if (duo[0].player_id == null || duo[1].player_id == null) return null;
		return momentumCurve({
			a: duo[0].player_id,
			b: duo[1].player_id,
			finalTurn: gameDetails.total_turns,
			yieldHistory: allYields,
			playerHistory,
			mapTiles: staticMapTiles,
			tileOwnership: tileOwnershipHistory,
		});
	});

	const DIM_LABELS: Record<string, string> = {
		cities: "Cities",
		growth: "Growth",
		orders: "Orders",
		science: "Science",
		eco: "Economy",
		mil: "Military",
	};

	const momentumOption = $derived.by<ChartOption | null>(() => {
		const curve = momentum;
		const duo = duelists;
		if (!curve || !duo) return null;
		const [a, b] = duo;
		return {
			...CHART_THEME,
			tooltip: {
				trigger: "axis",
				backgroundColor: TOOLTIP_SURFACE,
				borderColor: TOOLTIP_BORDER,
				textStyle: { color: TOOLTIP_TEXT },
				formatter: (params: unknown) => {
					const arr = params as { dataIndex: number }[];
					const pt = curve.points[arr[0]?.dataIndex ?? 0];
					if (!pt) return "";
					// Flip contributions toward whoever they favour — positive must
					// always mean "helped the named player" (leader here).
					const aLeads = pt.p >= 0.5;
					const leader = aLeads ? a : b;
					const pct = Math.round((aLeads ? pt.p : 1 - pt.p) * 100);
					const rows = curve.dims
						.map((dim, j) => ({
							dim,
							v: aLeads ? pt.lv[j] : -pt.lv[j],
						}))
						.sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
					const helps = rows.filter((r) => r.v > 0.005);
					const drags = rows.filter((r) => r.v < -0.005);
					const line = (r: { dim: string; v: number }) =>
						`<div>${DIM_LABELS[r.dim]} <b>${r.v > 0 ? "+" : ""}${r.v.toFixed(2)}</b></div>`;
					return (
						`<div style="font-weight:700;color:${leader.color}">Turn ${pt.turn} — ${leader.label} ${pct}%</div>` +
						(helps.length
							? `<div style="color:${TOOLTIP_MUTED};font-size:11px;margin-top:3px">Driving the lead</div>` +
								helps.map(line).join("")
							: "") +
						(drags.length
							? `<div style="color:${TOOLTIP_MUTED};font-size:11px;margin-top:3px">Dragging</div>` +
								drags.map(line).join("")
							: "") +
						`<div style="color:${TOOLTIP_MUTED};font-size:10px;margin-top:4px">Model reading of the finished match, not a forecast</div>`
					);
				},
			},
			grid: { left: 48, right: 24, top: 20, bottom: 40 },
			xAxis: {
				type: "category",
				data: curve.points.map((pt) => pt.turn),
				name: "Turn",
				nameLocation: "middle",
				nameGap: 24,
			},
			yAxis: {
				type: "value",
				min: 0,
				max: 100,
				axisLabel: { formatter: "{value}%" },
			},
			series: [
				{
					name: a.label,
					type: "line",
					showSymbol: false,
					data: curve.points.map((pt) => Math.round(pt.p * 1000) / 10),
					lineStyle: { color: a.color, width: 2 },
					itemStyle: { color: a.color },
					areaStyle: { color: a.color, opacity: 0.08 },
					markLine: {
						silent: true,
						symbol: "none",
						label: { show: false },
						lineStyle: { color: "#6b6459", type: "dashed" },
						data: [{ yAxis: 50 }],
					},
				},
				{
					name: b.label,
					type: "line",
					showSymbol: false,
					data: curve.points.map((pt) => Math.round((1 - pt.p) * 1000) / 10),
					lineStyle: { color: b.color, width: 2, opacity: 0.7 },
					itemStyle: { color: b.color },
				},
			],
		} as ChartOption;
	});
</script>

{#if momentumOption}
	<div
		class="mb-4 rounded-lg p-4"
		style="background-color: rgb(var(--color-surface));"
	>
		<ChartContainer option={momentumOption} height="300px" title="Momentum" />
	</div>
{/if}

<!-- Nation cards -->
<div
	class="mb-4 rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<h3 class="mb-3 text-base font-bold text-tan">Nations</h3>
	<div class="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
		{#each playerOverviews as player (player.playerId)}
			{@const borderColor = player.color}
			<div
				class="relative rounded-lg p-3"
				style="background-color: rgb(var(--color-surface-raised));"
			>
				{#if player.isWinner}
					<span
						class="absolute right-3 top-3 rounded bg-amber-700/40 px-1.5 py-0.5 text-xs text-amber-300"
						>Winner</span
					>
				{/if}
				<!-- Header: crest + nation name -->
				<div class="mb-3 flex items-center gap-3">
					{#if player.nation}
						<SpriteIcon
							category="crests"
							value={player.nation}
							size={24}
							alt={formatEnum(player.nation, "NATION_")}
						/>
					{/if}
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							{#if player.playerName}
								<span class="text-lg font-bold" style="color: {borderColor};">
									{player.playerName}
								</span>
								<span class="text-sm text-gray-400">
									({formatEnum(player.nation, "NATION_")})
								</span>
							{:else}
								<span class="text-lg font-bold" style="color: {borderColor};">
									{formatEnum(player.nation, "NATION_")}
								</span>
								{#if player.isHuman}
									<span class="text-sm text-gray-400">(Human)</span>
								{/if}
							{/if}
						</div>
					</div>
				</div>

				{#if player.army.length > 0}
					<div class="mb-3 flex h-5 overflow-hidden rounded">
						{#each player.army as slice (slice.unitClass)}
							{#if slice.pct > 0}
								<div
									class="flex items-center justify-center overflow-hidden whitespace-nowrap px-1 text-[10px] font-medium text-white"
									style="width: {Math.max(
										slice.pct,
										3,
									)}%; background-color: {UNIT_CLASS_COLORS[slice.unitClass]};"
									title="{slice.unitClass}: {slice.count} ({slice.pct}%)"
								>
									{#if slice.pct >= 30}
										{slice.unitClass} {slice.pct}%
									{:else if slice.pct >= 18}
										{UNIT_CLASS_ABBREV[slice.unitClass]} {slice.pct}%
									{:else if slice.pct >= 10}
										{UNIT_CLASS_ABBREV[slice.unitClass]}
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				{/if}

				<!-- Stats grid -->
				<div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
					<span class="font-bold text-gray-400">Cities</span>
					<span class="font-medium text-bright">{player.cityCount}</span>

					<span class="font-bold text-gray-400">Techs</span>
					<span class="font-medium text-bright">{player.techCount}</span>

					<span class="font-bold text-gray-400">Laws</span>
					<span class="font-medium text-bright">{player.lawCount}</span>

					{#if player.religions.length > 0}
						<span class="font-bold text-gray-400">Religions</span>
						<span
							class="flex flex-wrap items-center gap-y-0.5 font-medium text-bright"
						>
							{#each player.religions as rel, i (rel.religion_name)}
								<span class="flex items-center gap-0.5">
									<SpriteIcon
										category="religions"
										value={rel.religion_name}
										size={12}
										alt={formatEnum(rel.religion_name, "RELIGION_")}
									/>
									{formatEnum(
										rel.religion_name,
										"RELIGION_",
									)}{#if i < player.religions.length - 1},&nbsp;{/if}
								</span>
							{/each}
						</span>
					{:else if player.religion}
						<span class="font-bold text-gray-400">Religion</span>
						<span class="flex items-center gap-0.5 font-medium text-bright">
							<SpriteIcon
								category="religions"
								value={player.religion}
								size={12}
								alt={formatEnum(player.religion, "RELIGION_")}
							/>
							{formatEnum(player.religion, "RELIGION_")}
						</span>
					{/if}

					{#if player.wonders.length > 0}
						<span class="font-bold text-gray-400">Wonders</span>
						<span class="font-medium text-bright">
							{player.wonders
								.map((w) => improvementDisplayName(w.wonder))
								.join(", ")}
						</span>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>

<!-- Key Metrics -->
<div
	class="rounded-lg p-4"
	style="background-color: rgb(var(--color-surface));"
>
	<h3 class="mb-3 text-base font-bold text-tan">Key Metrics</h3>
	{#snippet metricPanel(metric: MetricBar)}
		<div
			class="rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<p class="mb-1 flex items-center gap-1 text-xs font-bold text-gray-400">
				{#if metric.sprite}
					<SpriteIcon
						category={metric.sprite.category}
						value={metric.sprite.value}
						size={14}
						alt={metric.label}
					/>
				{/if}
				{metric.label}
			</p>
			<div class="space-y-1">
				{#each metric.players as player (player.playerId)}
					<div class="flex items-center gap-2">
						<div class="relative h-2.5 flex-1 overflow-hidden rounded">
							<div
								class="h-full rounded"
								style="width: {Math.max(
									0,
									(player.value / metric.maxValue) * 100,
								)}%; background-color: {player.color};"
								title="{player.label}: {formatValue(player.value)}"
							></div>
						</div>
						<span class="w-10 text-right text-[11px] font-medium text-bright">
							{formatValue(player.value)}
						</span>
					</div>
				{/each}
			</div>
		</div>
	{/snippet}
	<!-- Row-major grid: each row pairs a left + right panel so they share a
	     height and stay aligned even when their row counts differ. -->
	<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
		{#each metricRows as row (row.key)}
			{#if row.left}
				{@render metricPanel(row.left)}
			{:else}
				<div class="hidden lg:block"></div>
			{/if}
			{#if row.right}
				{@render metricPanel(row.right)}
			{:else}
				<div class="hidden lg:block"></div>
			{/if}
		{/each}
	</div>
</div>
