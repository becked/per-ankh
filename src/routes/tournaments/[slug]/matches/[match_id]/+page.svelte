<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { GameDetailView } from "$lib/game-detail";
	import { reconstructMapTiles } from "$lib/game-detail/reconstruct-map-tiles";
	import { formatEnum } from "$lib/utils/formatting";
	import type { UserMe } from "$lib/api-cloud";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// User comes from the root layout via merged page.data. Drives the
	// upload affordances:
	//   - Participant on a pending match → "Upload save" (their own slot).
	//   - Tournament admin (regardless of status) → "Upload save (observer)"
	//     — admin uploads override existing match links and re-derive the
	//     winner from the new save.
	const user = $derived(page.data.user as UserMe | null);

	const slotUserById = $derived.by(() => {
		const out: Record<string, string | null> = {};
		for (const div of ["A", "B"] as const) {
			for (const s of data.standings.divisions[div].standings) {
				out[s.slot_id] = s.user_id;
			}
		}
		return out;
	});

	const isParticipant = $derived(
		user !== null &&
			(slotUserById[data.match.slot_a_id] === user.user_id ||
				(data.match.slot_b_id !== null &&
					slotUserById[data.match.slot_b_id] === user.user_id)),
	);
	const isAdmin = $derived(data.tournament.is_viewer_admin === true);
	const canUploadAsParticipant = $derived(
		isParticipant && data.match.status === "pending",
	);
	const canUploadAsObserver = $derived(isAdmin);

	const slotALabel = $derived(data.slotLabels[data.match.slot_a_id] ?? "—");
	const slotBLabel = $derived(
		data.match.slot_b_id
			? (data.slotLabels[data.match.slot_b_id] ?? "—")
			: "Bye",
	);
	const winnerLabel = $derived(
		data.match.winner_slot_id
			? (data.slotLabels[data.match.winner_slot_id] ?? null)
			: null,
	);
	const mapName = $derived(
		data.match.map_script
			? formatEnum(data.match.map_script, "MAPCLASS_")
			: null,
	);

	let selectedMapTurn = $state<number | null>(null);
	let mapTiles = $derived.by(() => {
		if (!data.game) return [];
		const turn = selectedMapTurn ?? data.game.game_details.total_turns;
		return reconstructMapTiles(data.game, turn);
	});

	async function handleMapTurnChange(turn: number): Promise<void> {
		selectedMapTurn = turn;
	}
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4">
			<nav
				class="mb-4 flex items-baseline justify-between gap-3 text-xs text-tan"
			>
				<a
					class="opacity-70 hover:text-orange hover:opacity-100"
					href={resolve("/tournaments/[slug]", {
						slug: data.tournament.slug,
					})}
				>
					← {data.tournament.name}
				</a>
				<div class="flex gap-2">
					{#if canUploadAsParticipant}
						<a
							class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1 text-xs text-tan transition-colors"
							href="{resolve('/upload')}?tournament_match_id={data.match
								.match_id}&return_slug={data.tournament.slug}"
						>
							Upload save
						</a>
					{/if}
					{#if canUploadAsObserver}
						<a
							class="rounded border border-brown px-3 py-1 text-xs text-tan transition-colors hover:bg-brown"
							href="{resolve('/upload')}?tournament_match_id={data.match
								.match_id}&return_slug={data.tournament.slug}&observer=1"
						>
							Upload save (observer)
						</a>
					{/if}
				</div>
			</nav>

			{#if data.game}
				<GameDetailView
					gameDetails={data.game.game_details}
					playerHistory={data.game.player_history}
					allYields={data.game.yield_history}
					eventLogs={data.game.event_logs}
					lawAdoptionHistory={data.game.law_adoption_history}
					currentLaws={data.game.current_laws}
					techDiscoveryHistory={data.game.tech_discovery_history}
					completedTechs={data.game.completed_techs}
					unitsProduced={data.game.units_produced}
					cityStatistics={data.game.city_statistics}
					improvementData={data.game.improvement_data}
					gameReligions={data.game.game_religions}
					playerWonders={data.game.player_wonders}
					{mapTiles}
					{selectedMapTurn}
					onMapTurnChange={handleMapTurnChange}
				>
					{#snippet preTabs()}
						<div
							class="bg-orange/10 mb-4 rounded border border-orange px-4 py-2 text-xs text-tan"
						>
							<span class="font-bold">{data.tournament.name}</span>
							<span class="opacity-80">
								— {slotALabel} vs {slotBLabel}{mapName ? ` · ${mapName}` : ""}
								{#if winnerLabel}
									· winner: <span class="text-orange">{winnerLabel}</span>
								{/if}
							</span>
						</div>
					{/snippet}
				</GameDetailView>
			{:else}
				<div class="mx-auto max-w-2xl">
					<header class="mb-6">
						<h1 class="text-xl font-bold text-tan">
							{slotALabel} vs {slotBLabel}
						</h1>
						{#if mapName}
							<p class="mt-1 text-sm text-tan opacity-70">{mapName}</p>
						{/if}
					</header>
					<div
						class="rounded border-2 border-black bg-blue-gray p-4 text-sm text-tan"
					>
						<p class="font-bold">No save attached</p>
						<p class="mt-2 opacity-80">
							{#if data.match.status === "pending"}
								This match is pending — players will attach a save when they
								report the result.
							{:else if data.match.status === "bye"}
								This is a bye — no save is required.
							{:else if data.match.status === "forfeit"}
								This match was recorded as a forfeit.
								{#if winnerLabel}
									Winner: <span class="text-orange">{winnerLabel}</span>.
								{/if}
							{:else}
								The reporter did not attach a save.
								{#if winnerLabel}
									Winner: <span class="text-orange">{winnerLabel}</span>.
								{/if}
							{/if}
						</p>
					</div>
				</div>
			{/if}
		</div>
	</main>
</div>
