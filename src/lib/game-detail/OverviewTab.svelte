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
	import { formatEnum } from "$lib/utils/formatting";
	import { type PlayerSummary, type SpriteCategory, getPlayerColor } from "./helpers";
	import SpriteIcon from "./SpriteIcon.svelte";

	let {
		gameDetails,
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
	}: {
		gameDetails: GameDetails;
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
	} = $props();

	// ─── Unit classification ─────────────────────────────────────────
	const RANGED_KEYWORDS = [
		"ARCHER",
		"BOWMAN",
		"CROSSBOW",
		"SLINGER",
		"SKIRMISHER",
		"JAVELINEER",
		"CLUB_THROWER",
	];
	const CAVALRY_KEYWORDS = [
		"CAVALRY",
		"CHARIOT",
		"CATAPHRACT",
		"HORSEMAN",
		"RIDER",
		"LANCER",
		"MOUNTED",
		"ELEPHANT",
		"CAMEL",
	];
	const SIEGE_KEYWORDS = [
		"BALLISTA",
		"ONAGER",
		"SIEGE",
		"CATAPULT",
		"RAM",
		"TORSION",
	];
	const NAVAL_KEYWORDS = [
		"BIREME",
		"TRIREME",
		"DROMON",
		"QUINQUEREME",
		"PENTECONTER",
		"GALLEY",
		"SHIP",
		"LONGBOAT",
	];
	const SUPPORT_KEYWORDS = [
		"WORKER",
		"MILITIA",
		"SETTLER",
		"SCOUT",
		"CARAVAN",
		"DISCIPLE",
		"DIPLOMAT",
		"MISSIONARY",
		"SPY",
		"MONK",
		"CLERIC",
		"PROPHET",
		"ENVOY",
		"TRADER",
	];

	type UnitClass = "Infantry" | "Ranged" | "Cavalry" | "Siege" | "Naval";

	function classifyUnit(unitType: string): UnitClass | null {
		const upper = unitType.toUpperCase();
		if (SUPPORT_KEYWORDS.some((k) => upper.includes(k))) return null;
		if (NAVAL_KEYWORDS.some((k) => upper.includes(k))) return "Naval";
		if (SIEGE_KEYWORDS.some((k) => upper.includes(k))) return "Siege";
		if (CAVALRY_KEYWORDS.some((k) => upper.includes(k)))
			return "Cavalry";
		if (RANGED_KEYWORDS.some((k) => upper.includes(k))) return "Ranged";
		return "Infantry";
	}

	const UNIT_CLASS_COLORS: Record<UnitClass, string> = {
		Infantry: "#C87941",
		Ranged: "#B8860B",
		Cavalry: "#CD853F",
		Siege: "#A0522D",
		Naval: "#8B4513",
	};

	const UNIT_CLASS_ABBREV: Record<UnitClass, string> = {
		Infantry: "Inf",
		Ranged: "Ran",
		Cavalry: "Cav",
		Siege: "Siege",
		Naval: "Nav",
	};

	// ─── Player summaries with army composition ──────────────────────
	type ArmySlice = { unitClass: UnitClass; count: number; pct: number };

	type PlayerReligion = { religion_name: string; founded_turn: number | null };

	type PlayerWonderEntry = { wonder: string; completed_turn: number };

	type PlayerOverview = PlayerSummary & {
		army: ArmySlice[];
		religions: PlayerReligion[];
		wonders: PlayerWonderEntry[];
	};

	const playerOverviews = $derived<PlayerOverview[]>(
		gameDetails.players.map((p) => {
			const ph = playerHistory.find((h) => h.nation === p.nation);
			const lastPoint = ph?.history.at(-1);

			const playerUnits = unitsProduced.filter(
				(u) => u.nation === p.nation,
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

			const religions: PlayerReligion[] = gameReligions
				.filter((r) => r.founder_nation === p.nation)
				.map((r) => ({ religion_name: r.religion_name, founded_turn: r.founded_turn }));

			const wonders: PlayerWonderEntry[] = playerWonders
				.filter((w) => w.nation === p.nation)
				.map((w) => ({ wonder: w.wonder, completed_turn: w.completed_turn }));

			return {
				playerName: p.player_name,
				nation: p.nation,
				isHuman: p.is_human,
				isSaveOwner: p === gameDetails.players.find((pl) => pl.is_human),
				isWinner: p.nation === gameDetails.winner_civilization,
				finalVP: lastPoint?.points ?? null,
				finalMilitary: lastPoint?.military_power ?? null,
				cityCount: cityStatistics.cities.filter(
					(c) => c.owner_nation === p.nation,
				).length,
				techCount: completedTechs.filter(
					(t) => t.nation === p.nation,
				).length,
				lawCount: currentLaws.filter((l) => l.nation === p.nation)
					.length,
				unitsTotal: totalUnits,
				religion: p.state_religion,
				religions,
				wonders,
				army,
			};
		}).sort((a, b) => {
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
		players: { nation: string | null; value: number; color: string }[];
		maxValue: number;
	};

	function buildMetric(
		label: string,
		getValue: (nation: string | null) => number, // eslint-disable-line no-unused-vars
		sprite: MetricSprite | null = null,
	): MetricBar {
		const colorOf = (nation: string | null) =>
			getPlayerColor(nation, gameDetails.players.findIndex((gp) => gp.nation === nation));
		const players = gameDetails.players
			.map((p) => ({ nation: p.nation, value: getValue(p.nation), color: colorOf(p.nation) }))
			.sort((a, b) => b.value - a.value);
		const maxVal = Math.max(...players.map((p) => p.value), 1);
		return { label, sprite, players, maxValue: maxVal };
	}

	function yieldMetric(yieldType: string, label: string): MetricBar {
		return buildMetric(label, (nation) => {
			const yieldData = allYields.find((y) => y.nation === nation && y.yield_type === yieldType);
			return Math.round(yieldData?.data.at(-1)?.amount ?? 0);
		}, { category: "yields", value: yieldType });
	}

	// Column 1: Victory Points, Orders, Military, Training
	const metricsCol1 = $derived<MetricBar[]>([
		...(victoryPointsEnabled
			? [buildMetric("Victory Points", (nation) => {
					const ph = playerHistory.find((h) => h.nation === nation);
					return ph?.history.at(-1)?.points ?? 0;
				}, { category: "icons", value: "VICTORY_NORMAL" })]
			: []),
		yieldMetric("YIELD_ORDERS", "Orders"),
		buildMetric("Military", (nation) => {
			const ph = playerHistory.find((h) => h.nation === nation);
			return ph?.history.at(-1)?.military_power ?? 0;
		}, { category: "icons", value: "MILITARY" }),
		yieldMetric("YIELD_TRAINING", "Training"),
	]);

	// Column 2: Science, Civics, Money, Improvements
	const metricsCol2 = $derived<MetricBar[]>([
		yieldMetric("YIELD_SCIENCE", "Science"),
		yieldMetric("YIELD_CIVICS", "Civics"),
		yieldMetric("YIELD_MONEY", "Money"),
		buildMetric("Improvements", (nation) =>
			improvementData.improvements.filter((imp) => imp.nation === nation).length,
			{ category: "icons", value: "IMPROVEMENT_FINISHED" },
		),
	]);

	function formatValue(value: number): string {
		if (value >= 10000) return `${(value / 1000).toFixed(1)}k`;
		if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
		return value.toString();
	}
</script>

<!-- Nation cards -->
<div
	class="mb-4 rounded-lg p-4"
	style="background-color: #2a2622;"
>
	<h3 class="mb-3 text-base font-bold text-tan">Nations</h3>
	<div class="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
	{#each playerOverviews as player, i (player.nation ?? i)}
			{@const borderColor = getPlayerColor(player.nation, i)}
			<div
				class="relative rounded-lg p-3"
				style="background-color: #35302B;"
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
								<span
									class="text-lg font-bold"
									style="color: {borderColor};"
								>
									{player.playerName}
								</span>
								<span class="text-sm text-gray-400">
									({formatEnum(player.nation, "NATION_")})
								</span>
							{:else}
								<span
									class="text-lg font-bold"
									style="color: {borderColor};"
								>
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
									style="width: {Math.max(slice.pct, 3)}%; background-color: {UNIT_CLASS_COLORS[slice.unitClass]};"
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
				<div
					class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs"
				>
					<span class="font-bold text-gray-400">Cities</span>
					<span class="font-medium text-[#DBDEE3]"
						>{player.cityCount}</span
					>

					<span class="font-bold text-gray-400">Techs</span>
					<span class="font-medium text-[#DBDEE3]"
						>{player.techCount}</span
					>

					<span class="font-bold text-gray-400">Laws</span>
					<span class="font-medium text-[#DBDEE3]"
						>{player.lawCount}</span
					>

					{#if player.religions.length > 0}
						<span class="font-bold text-gray-400">Religions</span>
						<span class="flex flex-wrap items-center gap-y-0.5 font-medium text-[#DBDEE3]">
							{#each player.religions as rel, i (rel.religion_name)}
								<span class="flex items-center gap-0.5">
									<SpriteIcon
										category="religions"
										value={rel.religion_name}
										size={12}
										alt={formatEnum(rel.religion_name, "RELIGION_")}
									/>
									{formatEnum(rel.religion_name, "RELIGION_")}{#if i < player.religions.length - 1},&nbsp;{/if}
								</span>
							{/each}
						</span>
					{:else if player.religion}
						<span class="font-bold text-gray-400">Religion</span>
						<span
							class="flex items-center gap-0.5 font-medium text-[#DBDEE3]"
						>
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
						<span class="font-medium text-[#DBDEE3]">
							{player.wonders.map((w) => formatEnum(w.wonder, "IMPROVEMENT_")).join(", ")}
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
	style="background-color: #2a2622;"
>
	<h3 class="mb-3 text-base font-bold text-tan">Key Metrics</h3>
	<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
		<!-- Column 1 -->
		<div class="space-y-3">
			{#each metricsCol1 as metric (metric.label)}
				<div
					class="rounded-lg p-3"
					style="background-color: #35302B;"
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
						{#each metric.players as player (player.nation)}
							<div class="flex items-center gap-2">
								<div
									class="relative h-2.5 flex-1 overflow-hidden rounded"
								>
									<div
										class="h-full rounded"
										style="width: {(player.value / metric.maxValue) * 100}%; background-color: {player.color};"
										title="{formatEnum(player.nation, 'NATION_')}: {formatValue(player.value)}"
									></div>
								</div>
								<span class="w-10 text-right text-[11px] font-medium text-[#DBDEE3]">
									{formatValue(player.value)}
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
		<!-- Column 2 -->
		<div class="space-y-3">
			{#each metricsCol2 as metric (metric.label)}
				<div
					class="rounded-lg p-3"
					style="background-color: #35302B;"
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
						{#each metric.players as player (player.nation)}
							<div class="flex items-center gap-2">
								<div
									class="relative h-2.5 flex-1 overflow-hidden rounded"
								>
									<div
										class="h-full rounded"
										style="width: {(player.value / metric.maxValue) * 100}%; background-color: {player.color};"
										title="{formatEnum(player.nation, 'NATION_')}: {formatValue(player.value)}"
									></div>
								</div>
								<span class="w-10 text-right text-[11px] font-medium text-[#DBDEE3]">
									{formatValue(player.value)}
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
