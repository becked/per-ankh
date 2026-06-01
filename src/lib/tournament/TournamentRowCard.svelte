<script lang="ts">
	import { resolve } from "$app/paths";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import StatTile from "$lib/StatTile.svelte";
	import type { TournamentListItem } from "$lib/api-cloud";

	let {
		tournament,
		enrolled = false,
	}: {
		tournament: TournamentListItem;
		enrolled?: boolean;
	} = $props();

	// Phase pill mirrors the small TournamentCard's status label, with the
	// active round folded in when the tournament is mid-round so the player
	// sees "Swiss · Rd 3" instead of just "Swiss".
	const phaseLabel = $derived.by(() => {
		const base = {
			setup: "Setup",
			swiss: "Swiss",
			championship: "Championship",
			complete: "Complete",
		}[tournament.status];
		if (
			tournament.active_round &&
			(tournament.status === "swiss" || tournament.status === "championship")
		) {
			return `${base} · Rd ${tournament.active_round.round_number}`;
		}
		return base;
	});

	// Headline badge: "✓ You're in" trumps everything; "Signups open" is the
	// next-best signal for setup; otherwise we fall back to the phase pill
	// so completed tournaments show "Complete" rather than blank.
	const badgeLabel = $derived(
		enrolled
			? "✓ You're in"
			: tournament.status === "setup" && tournament.signups_open
				? "Signups open"
				: phaseLabel,
	);
	const badgeColor = $derived(
		enrolled || (tournament.status === "setup" && tournament.signups_open)
			? "text-orange"
			: tournament.status === "complete"
				? "text-tan opacity-60"
				: "text-tan",
	);

	const formatLabel = $derived(
		`${tournament.swiss_wins_to_advance}W · ${tournament.swiss_losses_to_eliminate}L · ${tournament.swiss_max_rounds}R`,
	);
</script>

<a
	href={resolve("/tournaments/[slug]", { slug: tournament.slug })}
	class="block rounded-lg p-3 transition-colors hover:bg-surface-hover"
	style="background-color: rgb(var(--color-surface-raised));"
>
	<div class="mb-3 flex items-center justify-between gap-2">
		<div class="flex min-w-0 items-center gap-1.5">
			<SpriteIcon
				category="icons"
				value="GAME_HELP"
				size={16}
				alt="Tournament"
			/>
			<span class="truncate text-lg font-bold text-white">
				{tournament.name}
			</span>
		</div>
		<span
			class="shrink-0 rounded bg-amber-700/40 px-1.5 py-0.5 text-xs uppercase tracking-wide {badgeColor}"
		>
			{badgeLabel}
		</span>
	</div>

	<!-- Stat boxes. Layout mirrors RecentSaveCard: same colors, padding,
	     and grid breakpoints so the two pages read as siblings. -->
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
		<StatTile label="Phase">
			{#snippet icon()}
				<SpriteIcon category="icons" value="TURN" size={10} alt="Phase" />
			{/snippet}
			{phaseLabel}
		</StatTile>

		<StatTile label="Players">
			{#snippet icon()}
				<SpriteIcon
					category="icons"
					value="MULTIPLAYER"
					size={10}
					alt="Players"
				/>
			{/snippet}
			{tournament.player_count > 0 ? tournament.player_count : "—"}
		</StatTile>

		<StatTile label="Maps">
			{#snippet icon()}
				<SpriteIcon
					category="icons"
					value="MAP_OVERVIEW"
					size={10}
					alt="Maps"
				/>
			{/snippet}
			{tournament.map_pool_size > 0 ? tournament.map_pool_size : "—"}
		</StatTile>

		<StatTile label="Format">
			{#snippet icon()}
				<SpriteIcon category="icons" value="STATS" size={10} alt="Format" />
			{/snippet}
			{formatLabel}
		</StatTile>

		{#if tournament.champion}
			<div
				class="rounded p-2"
				style="background-color: rgb(var(--color-surface));"
			>
				<p
					class="mb-0.5 flex items-center gap-1 text-[10px] font-bold text-gray-400"
				>
					<SpriteIcon
						category="icons"
						value="ACHIEVEMENT_WIN"
						size={10}
						alt="Champion"
					/>
					Champion
				</p>
				<div class="flex min-w-0 items-center gap-1">
					{#if tournament.champion.avatar_url}
						<img
							src={tournament.champion.avatar_url}
							alt=""
							class="h-4 w-4 shrink-0 rounded-full"
							width="16"
							height="16"
						/>
					{/if}
					<p class="truncate text-sm font-bold text-bright">
						{tournament.champion.display_name}
					</p>
				</div>
			</div>
		{:else if tournament.active_round}
			<StatTile label="Round {tournament.active_round.round_number}">
				{#snippet icon()}
					<SpriteIcon
						category="icons"
						value="VICTORY_NORMAL"
						size={10}
						alt="Round"
					/>
				{/snippet}
				{tournament.active_round.matches_reported} /
				{tournament.active_round.matches_total} reported
			</StatTile>
		{/if}
	</div>
</a>
