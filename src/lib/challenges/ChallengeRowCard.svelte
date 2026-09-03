<script lang="ts">
	// One challenge on the /challenges list. Layout mirrors TournamentRowCard
	// (title row + badge, then StatTiles) so the two browse pages read as
	// siblings.
	import { resolve } from "$app/paths";
	import type { ChallengeListItem } from "$lib/api-cloud";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import StatTile from "$lib/StatTile.svelte";
	import { formatRelativeToNow } from "$lib/utils/formatting";
	import { describeSetup } from "./describe";

	let { challenge }: { challenge: ChallengeListItem } = $props();

	const setupLine = $derived(describeSetup(challenge.setup).join(" · "));
</script>

<a
	href={resolve("/challenges/[number]", { number: String(challenge.number) })}
	class="block rounded-lg p-3 transition-colors hover:bg-surface-hover"
	style="background-color: rgb(var(--color-surface-raised));"
>
	<div class="mb-1 flex items-center justify-between gap-2">
		<div class="flex min-w-0 items-center gap-1.5">
			<SpriteIcon
				category="icons"
				value="ACHIEVEMENT"
				size={16}
				alt="Challenge"
			/>
			<span class="truncate text-lg font-bold text-white">
				#{challenge.number} · {challenge.title}
			</span>
		</div>
		<span
			class="shrink-0 rounded bg-amber-700/40 px-1.5 py-0.5 text-xs uppercase tracking-wide {challenge.status ===
			'open'
				? 'text-orange'
				: 'text-tan opacity-60'}"
		>
			{challenge.status === "open" ? "Open" : "Closed"}
		</span>
	</div>
	<p class="mb-3 truncate text-xs text-gray-400">
		{setupLine} · by {challenge.creator.display_name}
	</p>

	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		<StatTile label="Objectives">
			{#snippet icon()}
				<SpriteIcon
					category="icons"
					value="GOAL_STARTED"
					size={10}
					alt="Objectives"
				/>
			{/snippet}
			{challenge.objectives.length}
		</StatTile>
		<StatTile label="Runners">
			{#snippet icon()}
				<SpriteIcon
					category="icons"
					value="MULTIPLAYER"
					size={10}
					alt="Runners"
				/>
			{/snippet}
			{challenge.runner_count > 0 ? challenge.runner_count : "—"}
		</StatTile>
		<StatTile label="Best">
			{#snippet icon()}
				<SpriteIcon category="icons" value="TURN" size={10} alt="Best" />
			{/snippet}
			{#if challenge.best}
				{challenge.best.user.display_name} · T{challenge.best.score_turn}
			{:else}
				—
			{/if}
		</StatTile>
		<StatTile label={challenge.status === "open" ? "Closes" : "Closed"}>
			{#snippet icon()}
				<SpriteIcon category="icons" value="TURN" size={10} alt="Closes" />
			{/snippet}
			{formatRelativeToNow(challenge.closes_at)}
		</StatTile>
	</div>
</a>
