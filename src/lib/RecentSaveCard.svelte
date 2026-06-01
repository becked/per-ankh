<script lang="ts">
	import type { EChartsOption } from "echarts";
	import { resolve } from "$app/paths";
	import Chart from "$lib/Chart.svelte";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import StatTile from "$lib/StatTile.svelte";
	import type { PublicRecentGame } from "$lib/api-cloud";
	import {
		formatEnum,
		formatDate,
		formatGameTitle,
		formatMapClass,
	} from "$lib/utils/formatting";
	import {
		CHART_THEME,
		getChartColor,
		getCivilizationColor,
	} from "$lib/config";

	let { game }: { game: PublicRecentGame } = $props();

	function playerColor(nation: string | null, idx: number): string {
		if (nation) {
			const c = getCivilizationColor(nation);
			if (c) return c;
		}
		return getChartColor(idx);
	}

	// Sort uploader first, then by player_index — anchors sparkline colors.
	const orderedPlayers = $derived(
		[...game.players].sort((a, b) => {
			if (a.is_uploader !== b.is_uploader) return a.is_uploader ? -1 : 1;
			return a.player_index - b.player_index;
		}),
	);

	// Card spotlights one player: the winner if one exists, otherwise the
	// player with the highest final_points (the leader). Considers AI as
	// well as humans — the roster now includes both. Mirrors the
	// per-player Nations card on the Overview tab.
	type Featured = (typeof orderedPlayers)[number] | null;
	const featured = $derived<Featured>(
		orderedPlayers.find((p) => p.is_winner) ??
			[...orderedPlayers]
				.filter((p) => p.final_points != null)
				.sort((a, b) => (b.final_points ?? 0) - (a.final_points ?? 0))[0] ??
			null,
	);
	// "Player" stat box = uploader's picked nation, falling back to the
	// uploader's player row, then the first player in the roster. Matches
	// the `humanNation` derivation in the game-detail header so anonymous
	// viewers see the same identity.
	const humanNation = $derived(
		game.user_nation ??
			game.players.find((p) => p.is_uploader)?.nation ??
			game.players[0]?.nation ??
			null,
	);

	// Winner stat box label: "<player_name> (<Nation>)" mirroring
	// GameDetailView. Falls back to nation alone, then a dash.
	const winnerLabel = $derived.by(() => {
		const winningPlayer = game.players.find(
			(p) => p.is_winner || p.nation === game.winner_nation,
		);
		const winnerName = game.winner_name ?? winningPlayer?.player_name ?? null;
		if (winnerName && game.winner_nation) {
			return `${winnerName} (${formatEnum(game.winner_nation, "NATION_")})`;
		}
		if (game.winner_nation) return formatEnum(game.winner_nation, "NATION_");
		return "—";
	});

	const sparklineOption = $derived<EChartsOption>({
		animation: false,
		backgroundColor: "transparent",
		grid: { left: 4, right: 4, top: 4, bottom: 4 },
		xAxis: {
			type: "value",
			show: false,
			min: 0,
			max: game.total_turns > 0 ? game.total_turns : undefined,
		},
		yAxis: { type: "value", show: false, min: 0 },
		tooltip: {
			...CHART_THEME.tooltip,
			trigger: "axis",
			formatter: (params: unknown) => {
				const arr = params as Array<{
					seriesName: string;
					value: [number, number];
					color: string;
				}>;
				if (!arr.length) return "";
				const turn = arr[0].value[0];
				const rows = arr
					.map(
						(p) =>
							`<span style="display:inline-block;width:8px;height:8px;background:${p.color};margin-right:4px;"></span>${p.seriesName}: ${p.value[1]}`,
					)
					.join("<br/>");
				return `Victory Points (VP)<br/>Turn ${turn}<br/>${rows}`;
			},
		},
		series: orderedPlayers.map((p, i) => ({
			name: `${p.player_name}${p.nation ? ` (${formatEnum(p.nation, "NATION_")})` : ""}`,
			type: "line",
			showSymbol: false,
			smooth: true,
			sampling: "lttb",
			lineStyle: { width: 1.5, color: playerColor(p.nation, i) },
			data: p.vp_series.map((pt) => [pt.turn, pt.vp ?? 0]),
		})),
	});

	const hasSparkline = $derived(
		orderedPlayers.some((p) => p.vp_series.length > 0),
	);

	// MP = >1 human seat. Counting all players reads as MP for every save
	// once AI is in the roster (which it is, for the sparkline).
	const isMultiplayer = $derived(
		game.players.filter((p) => p.is_human).length > 1,
	);

	const subtitleDate = $derived(
		game.save_date && formatDate(game.save_date) !== "Unknown"
			? formatDate(game.save_date)
			: formatDate(game.created_at),
	);

	// match_id: 0 is only consulted if game_name + nation + total_turns are
	// all missing — degenerate save in practice. Mirrors CloudGameSidebar.
	const gameTitle = $derived(
		formatGameTitle({
			display_name: game.display_name,
			game_name: game.game_name,
			save_owner_nation: game.user_nation,
			total_turns: game.total_turns,
			match_id: 0,
		}),
	);
</script>

<div
	class="relative rounded-lg p-3 transition-colors hover:bg-surface-hover"
	style="background-color: rgb(var(--color-surface-raised));"
>
	<!-- Stretched-link overlay: the whole card navigates to the game, but the
	     uploader link below sits above this overlay (higher z-index) so it wins
	     clicks on the name/avatar. Two real, non-nested anchors — middle-click
	     and open-in-new-tab work for both. -->
	<a
		href={resolve("/games/[id]", { id: game.game_id })}
		class="absolute inset-0 z-10 rounded-lg"
		aria-label={gameTitle}
	></a>

	<!-- Discovery row: uploader (left) + game title (center) + save date
	     (right). Equal-flex side columns keep the title visually centered
	     even when the uploader name or date pill grow. Date pill reuses
	     the amber treatment that the "Winner" badge previously used. -->
	<div class="mb-2 flex items-center gap-2">
		<div class="flex min-w-0 flex-1">
			<a
				href={resolve("/users/[user_id]", { user_id: game.uploader_user_id })}
				class="relative z-20 flex min-w-0 items-center gap-1.5 hover:underline"
			>
				<img
					src={game.uploader_avatar_url}
					alt=""
					class="h-5 w-5 shrink-0 rounded-full"
					width="20"
					height="20"
					loading="lazy"
				/>
				<span class="truncate text-lg font-bold text-white">
					{game.uploader_display_name}
				</span>
			</a>
		</div>
		<span
			class="min-w-0 flex-1 truncate text-center text-lg font-bold text-tan"
		>
			{gameTitle}
		</span>
		<div class="flex flex-1 justify-end">
			<span
				class="shrink-0 rounded bg-amber-700/40 px-1.5 py-0.5 text-xs text-amber-300"
			>
				{subtitleDate}
			</span>
		</div>
	</div>

	<!-- Game header stats: Player / Winner / Victory Type / Map / Difficulty.
	     Mirrors the row at the top of GameDetailView (Turns lives on the
	     featured-player row below). Inner boxes use the section bg color
	     so they sit visually "inside" the card. -->
	<div class="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
		<StatTile label="Player">
			{#snippet icon()}
				{#if humanNation}
					<SpriteIcon
						category="crests"
						value={humanNation}
						size={10}
						alt={formatEnum(humanNation, "NATION_")}
					/>
				{/if}
			{/snippet}
			{humanNation ? formatEnum(humanNation, "NATION_") : "—"}
		</StatTile>

		<StatTile label="Winner">
			{#snippet icon()}
				<SpriteIcon
					category="icons"
					value="ACHIEVEMENT_WIN"
					size={10}
					alt="Winner"
				/>
			{/snippet}
			{winnerLabel}
		</StatTile>

		<StatTile label="Victory Type">
			{#snippet icon()}
				<SpriteIcon
					category="icons"
					value="VICTORY_NORMAL"
					size={10}
					alt="Victory Type"
				/>
			{/snippet}
			{game.victory_type ? formatEnum(game.victory_type, "VICTORY_") : "—"}
		</StatTile>

		<StatTile label="Map">
			{#snippet icon()}
				<SpriteIcon category="icons" value="MAP_OVERVIEW" size={10} alt="Map" />
			{/snippet}
			{game.map_class
				? formatMapClass(game.map_class)
				: game.map_size
					? formatEnum(game.map_size, "MAPSIZE_")
					: "—"}
		</StatTile>

		{#if isMultiplayer}
			<StatTile label="Multiplayer">
				{#snippet icon()}
					<SpriteIcon
						category="icons"
						value="MULTIPLAYER"
						size={10}
						alt="Multiplayer"
					/>
				{/snippet}
				Multiplayer
			</StatTile>
		{:else}
			<StatTile label="Difficulty">
				{#snippet icon()}
					<SpriteIcon
						category="crests"
						value="TRIBE_REBELS"
						size={10}
						alt="Difficulty"
					/>
				{/snippet}
				{game.difficulty ? formatEnum(game.difficulty, "DIFFICULTY_") : "—"}
			</StatTile>
		{/if}
	</div>

	<!-- Featured-player stats: Cities / Techs / Laws / VP / Turns. Same box style
	     as the row above. Icons are sourced from pinacotheca:
	     CITY_FOUNDED / TECH_DISCOVERED / LAW_ADOPTED / STATS. -->
	{#if featured && (featured.cities_total != null || featured.techs_completed != null || featured.laws_count != null || featured.final_points != null)}
		<div class="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
			<StatTile label="Cities">
				{#snippet icon()}
					<SpriteIcon
						category="icons"
						value="CITY_FOUNDED"
						size={10}
						alt="Cities"
					/>
				{/snippet}
				{featured.cities_total ?? "—"}
			</StatTile>
			<StatTile label="Techs">
				{#snippet icon()}
					<SpriteIcon
						category="techs"
						value="TECH_DISCOVERED"
						size={10}
						alt="Techs"
					/>
				{/snippet}
				{featured.techs_completed ?? "—"}
			</StatTile>
			<StatTile label="Laws">
				{#snippet icon()}
					<SpriteIcon
						category="laws"
						value="LAW_ADOPTED"
						size={10}
						alt="Laws"
					/>
				{/snippet}
				{featured.laws_count ?? "—"}
			</StatTile>
			<StatTile label="VP">
				{#snippet icon()}
					<SpriteIcon category="icons" value="STATS" size={10} alt="VP" />
				{/snippet}
				{featured.final_points ?? "—"}
			</StatTile>
			<StatTile label="Turns">
				{#snippet icon()}
					<SpriteIcon category="icons" value="TURN" size={10} alt="Turns" />
				{/snippet}
				{game.total_turns}
			</StatTile>
		</div>
	{/if}

	{#if hasSparkline}
		<!-- Dark chart background matches CHART_THEME.backgroundColor used
		     by the game-detail charts, so this sparkline reads as the same
		     visual family. -->
		<div
			class="rounded p-1"
			style="background-color: rgb(var(--color-surface-sunken));"
		>
			<Chart option={sparklineOption} height="60px" />
		</div>
	{/if}
</div>
