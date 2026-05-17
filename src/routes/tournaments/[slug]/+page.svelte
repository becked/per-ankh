<script lang="ts">
	import { invalidateAll, pushState } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import {
		ApiError,
		cloudApi,
		type Division,
		type TournamentMatch,
		type UserMe,
	} from "$lib/api-cloud";
	import ChampionshipBracketTree from "$lib/tournament/ChampionshipBracketTree.svelte";
	import MatchModal from "$lib/tournament/MatchModal.svelte";
	import SlotUsernameCell from "$lib/tournament/SlotUsernameCell.svelte";
	import SwissFlowBracket from "$lib/tournament/SwissFlowBracket.svelte";
	import SwissStandings from "$lib/tournament/SwissStandings.svelte";
	import TournamentSettingsModal from "$lib/tournament/TournamentSettingsModal.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const isAdmin = $derived(data.tournament.is_viewer_admin === true);
	const user = $derived(page.data.user as UserMe | null);

	// Swiss-phase matches, filtered per division. The flow bracket needs
	// only its own division's matches so the (W, L) record walk doesn't
	// mix slots from the parallel division.
	function swissMatchesFor(division: Division): TournamentMatch[] {
		return data.matches.filter(
			(m) => m.phase === "swiss" && m.division === division,
		);
	}

	const matchesByDivision = $derived({
		A: swissMatchesFor("A"),
		B: swissMatchesFor("B"),
	});

	const hasAnyStandings = $derived(
		data.standings.divisions.A.standings.length > 0 ||
			data.standings.divisions.B.standings.length > 0,
	);

	// Slot identity maps. Union of swiss standings (per-division) and
	// championship bracket slots — a slot can appear in both during the
	// championship phase.
	const slotLabels = $derived.by(() => {
		const out: Record<string, string> = {};
		for (const div of ["A", "B"] as const) {
			for (const s of data.standings.divisions[div].standings) {
				if (s.discord_username) out[s.slot_id] = s.discord_username;
			}
		}
		for (const s of data.bracket.slots) {
			if (s.discord_username) out[s.slot_id] = s.discord_username;
		}
		return out;
	});

	const slotUserIds = $derived.by(() => {
		const out: Record<string, string | null> = {};
		for (const div of ["A", "B"] as const) {
			for (const s of data.standings.divisions[div].standings) {
				out[s.slot_id] = s.user_id;
			}
		}
		for (const s of data.bracket.slots) {
			out[s.slot_id] = s.user_id;
		}
		return out;
	});

	// --- Match modal state. pushState is shallow routing — page.url updates
	// in the browser but page.state is the actually-reactive source. So we
	// stash the open match_id under page.state.match (reactive), with a
	// fallback to page.url.searchParams for the initial-load case (deep
	// link or post-upload redirect where page.state hasn't been populated
	// yet). page.state.match === null is the explicit "closed" sentinel
	// after a user action; undefined means "fall through to URL".

	const openMatchId = $derived.by(() => {
		const stateValue = (page.state as { match?: string | null }).match;
		if (stateValue === null) return null;
		if (typeof stateValue === "string") return stateValue;
		return page.url.searchParams.get("match");
	});
	const currentMatch = $derived(
		openMatchId
			? (data.matches.find((m) => m.match_id === openMatchId) ?? null)
			: null,
	);

	function openMatch(matchId: string) {
		const base = resolve("/tournaments/[slug]", {
			slug: data.tournament.slug,
		});
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() result composed with a query string; rule doesn't see resolve() through the local var
		pushState(`${base}?match=${encodeURIComponent(matchId)}`, {
			match: matchId,
		});
	}

	function closeMatch() {
		pushState(
			resolve("/tournaments/[slug]", { slug: data.tournament.slug }),
			{ match: null },
		);
	}

	// If the URL references a match that doesn't exist in our match list
	// (stale link, cascade delete during edit), strip the param so the
	// closed-modal state is reflected in the URL.
	$effect(() => {
		if (openMatchId && !currentMatch) closeMatch();
	});

	// --- Admin action surface: busy/banner + lifecycle gates + handlers.

	let busy = $state(false);
	let banner = $state<{ kind: "ok" | "err"; message: string } | null>(null);
	let settingsOpen = $state(false);

	const slotsA = $derived(data.standings.divisions.A.standings);
	const slotsB = $derived(data.standings.divisions.B.standings);

	const startReady = $derived(
		data.tournament.status === "setup" &&
			slotsA.length > 0 &&
			slotsB.length > 0,
	);

	// Both divisions must have played up to swiss_max_rounds with no
	// pending matches in their final round before championship is offered.
	// Derived from matches (no separate rounds load needed).
	function isDivisionSwissComplete(division: Division): boolean {
		const swissMatches = matchesByDivision[division];
		if (swissMatches.length === 0) return false;
		const maxRound = swissMatches.reduce(
			(acc, m) => Math.max(acc, m.round_number ?? 0),
			0,
		);
		if (maxRound < data.tournament.swiss_max_rounds) return false;
		const lastRound = swissMatches.filter((m) => m.round_number === maxRound);
		return !lastRound.some((m) => m.status === "pending");
	}
	const transitionReady = $derived(
		data.tournament.status === "swiss" &&
			isDivisionSwissComplete("A") &&
			isDivisionSwissComplete("B"),
	);

	async function withBusy<T>(
		op: () => Promise<T>,
		successMessage?: string,
	): Promise<T | null> {
		busy = true;
		banner = null;
		try {
			const out = await op();
			if (successMessage) banner = { kind: "ok", message: successMessage };
			await invalidateAll();
			return out;
		} catch (err) {
			let message = "Action failed";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			banner = { kind: "err", message };
			return null;
		} finally {
			busy = false;
		}
	}

	let newSlotUsername = $state("");
	let newSlotDivision = $state<Division>("A");

	async function addSlot() {
		const username = newSlotUsername.trim();
		if (!username) return;
		const result = await withBusy(
			() =>
				cloudApi.bulkCreateSlots(data.tournament.tournament_id, [
					{ division: newSlotDivision, discord_username: username },
				]),
			`Added ${username} to division ${newSlotDivision}`,
		);
		if (result) newSlotUsername = "";
	}

	async function substituteSlot(slotId: string, newUsername: string) {
		if (!newUsername.trim()) return;
		await withBusy(
			() =>
				cloudApi.patchSlot(data.tournament.tournament_id, slotId, {
					discord_username: newUsername.trim(),
				}),
			`Substituted slot to ${newUsername}`,
		);
	}

	function slotLabelFor(slotId: string): string {
		return slotLabels[slotId] ?? `slot ${slotId.slice(0, 6)}`;
	}

	async function deleteSlot(slotId: string) {
		if (!confirm(`Delete slot ${slotLabelFor(slotId)}?`)) return;
		await withBusy(
			() => cloudApi.deleteSlot(data.tournament.tournament_id, slotId),
			"Deleted slot",
		);
	}

	async function startTournament() {
		if (
			!confirm(
				"Start the tournament? Locks the slot list and generates Round 1 for both divisions.",
			)
		)
			return;
		await withBusy(
			() => cloudApi.startTournament(data.tournament.tournament_id),
			"Started tournament",
		);
	}

	async function transitionChampionship() {
		if (
			!confirm(
				"Transition to championship? Builds the bracket from Swiss results. This cannot be undone.",
			)
		)
			return;
		await withBusy(
			() => cloudApi.transitionChampionship(data.tournament.tournament_id),
			"Transitioned to championship",
		);
	}
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div>
				<header class="mb-6">
					<div class="flex items-baseline justify-between gap-3">
						<h1 class="text-2xl font-bold text-tan">{data.tournament.name}</h1>
						<span
							class="whitespace-nowrap rounded border border-orange px-2 py-0.5 text-xs uppercase text-orange"
						>
							{data.tournament.status}
						</span>
					</div>
					{#if data.tournament.description}
						<p class="mt-2 text-sm text-tan opacity-80">
							{data.tournament.description}
						</p>
					{/if}

					{#if isAdmin}
						<div class="mt-3 flex flex-wrap items-center justify-end gap-2">
							{#if data.tournament.status === "setup"}
								<button
									type="button"
									class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs text-tan disabled:opacity-50"
									onclick={startTournament}
									disabled={busy || !startReady}
									title={startReady
										? ""
										: "Add at least one player to each division to start"}
								>
									Start Tournament
								</button>
							{:else if data.tournament.status === "swiss"}
								<button
									type="button"
									class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs text-tan disabled:opacity-50"
									onclick={transitionChampionship}
									disabled={busy || !transitionReady}
									title={transitionReady
										? ""
										: "All swiss rounds must finish before championship can start"}
								>
									Transition to Championship
								</button>
							{/if}
							<button
								type="button"
								class="rounded border border-brown px-3 py-1.5 text-xs text-tan transition-colors hover:bg-brown disabled:opacity-50"
								onclick={() => (settingsOpen = true)}
								disabled={busy || openMatchId !== null}
								aria-label="Tournament settings"
							>
								<span class="inline-flex items-center gap-1">
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-3.5 w-3.5"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										stroke-width="2"
										aria-hidden="true"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
										/>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
										/>
									</svg>
									Settings
								</span>
							</button>
						</div>
					{/if}
				</header>

				{#if banner}
					<div
						class="mb-4 rounded border px-3 py-2 text-sm"
						class:border-orange={banner.kind === "ok"}
						class:text-orange={banner.kind === "ok"}
						class:border-red-500={banner.kind === "err"}
						class:text-red-400={banner.kind === "err"}
						role="status"
					>
						{banner.message}
					</div>
				{/if}

				{#if data.tournament.status === "setup"}
					<section
						class="mb-6 rounded-lg p-4"
						style="background-color: #2a2622;"
					>
						<h2 class="mb-3 text-sm font-bold text-tan">Slots</h2>

						{#if isAdmin}
							<div
								class="mb-3 flex flex-wrap items-end gap-2 rounded-lg p-3"
								style="background-color: #35302B;"
							>
								<label class="text-xs text-tan">
									Discord username
									<input
										type="text"
										bind:value={newSlotUsername}
										class="mt-1 block rounded border border-black bg-[#35302b] p-1.5 text-xs text-tan"
									/>
								</label>
								<fieldset class="text-xs text-tan">
									<legend>Division</legend>
									<div class="mt-1 flex gap-3">
										<label class="flex cursor-pointer items-center gap-1">
											<input
												type="radio"
												value="A"
												bind:group={newSlotDivision}
											/>
											{data.tournament.division_a_name}
										</label>
										<label class="flex cursor-pointer items-center gap-1">
											<input
												type="radio"
												value="B"
												bind:group={newSlotDivision}
											/>
											{data.tournament.division_b_name}
										</label>
									</div>
								</fieldset>
								<button
									type="button"
									class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs text-tan disabled:opacity-50"
									onclick={addSlot}
									disabled={busy || !newSlotUsername.trim()}
								>
									Add slot
								</button>
							</div>
						{:else if !hasAnyStandings}
							<p class="mb-3 text-xs text-tan opacity-70">
								The tournament hasn't started yet. Claimants will appear here as
								they're added.
							</p>
						{/if}

						<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
							{#each ["A", "B"] as const as div (div)}
								{@const slots = data.standings.divisions[div].standings}
								<div class="rounded-lg p-3" style="background-color: #35302B;">
									<h3 class="mb-2 text-xs uppercase text-tan opacity-70">
										{data.standings.divisions[div].name}
									</h3>
									{#if slots.length === 0}
										<p class="text-xs text-tan opacity-50">No slots yet.</p>
									{:else}
										<table class="w-full text-xs text-tan">
											<thead>
												<tr class="border-b border-black">
													<th class="py-1 pr-2 text-left">#</th>
													<th class="py-1 pr-2 text-left">Username</th>
													<th class="py-1 text-right">Claimed</th>
													{#if isAdmin}
														<th class="py-1 pl-2 text-right"></th>
													{/if}
												</tr>
											</thead>
											<tbody>
												{#each slots as s (s.slot_id)}
													<tr
														class="border-b border-black border-opacity-30 last:border-0"
													>
														<td class="py-1 pr-2 font-mono">
															{s.swiss_seed ?? s.rank}
														</td>
														<td class="py-1 pr-2">
															{#if isAdmin}
																<SlotUsernameCell
																	slotId={s.slot_id}
																	username={s.discord_username}
																	disabled={busy}
																	onSubstitute={(u) =>
																		substituteSlot(s.slot_id, u)}
																/>
															{:else}
																{s.discord_username ??
																	`slot ${s.slot_id.slice(0, 6)}`}
															{/if}
														</td>
														<td class="py-1 text-right">
															{s.user_id ? "✓" : "—"}
														</td>
														{#if isAdmin}
															<td class="py-1 pl-2 text-right">
																<button
																	type="button"
																	class="text-xs text-tan opacity-50 hover:text-red-400 hover:opacity-100 disabled:opacity-20"
																	onclick={() => deleteSlot(s.slot_id)}
																	disabled={busy}
																	aria-label="Delete slot"
																>
																	×
																</button>
															</td>
														{/if}
													</tr>
												{/each}
											</tbody>
										</table>
									{/if}
								</div>
							{/each}
						</div>
					</section>
				{:else if !hasAnyStandings}
					<section
						class="mb-6 rounded-lg p-6 text-center"
						style="background-color: #2a2622;"
					>
						<p class="text-sm text-tan opacity-70">
							No standings available yet.
						</p>
					</section>
				{:else}
					{#each ["A", "B"] as const as division (division)}
						{@const divisionData = data.standings.divisions[division]}
						{#if divisionData.standings.length > 0}
							<section class="mb-8">
								<h2 class="mb-3 text-lg font-bold text-tan">
									{divisionData.name}
								</h2>
								<div class="space-y-3">
									<SwissFlowBracket
										winsToAdvance={data.tournament.swiss_wins_to_advance}
										lossesToEliminate={data.tournament
											.swiss_losses_to_eliminate}
										maxRounds={data.tournament.swiss_max_rounds}
										standings={divisionData.standings}
										matches={matchesByDivision[division]}
										tournamentSlug={data.tournament.slug}
										onMatchClick={openMatch}
									/>
									<SwissStandings
										divisionName=""
										standings={divisionData.standings}
										isViewerAdmin={isAdmin}
										{busy}
										onSubstitute={substituteSlot}
									/>
								</div>
							</section>
						{/if}
					{/each}
				{/if}

				{#if data.bracket.rounds.length > 0}
					<section
						class="mb-6 rounded-lg p-4"
						style="background-color: #2a2622;"
					>
						<h2 class="mb-3 text-sm font-bold text-tan">
							Championship Bracket
						</h2>
						<ChampionshipBracketTree
							bracket={data.bracket}
							tournamentSlug={data.tournament.slug}
							onMatchClick={openMatch}
						/>
					</section>
				{/if}
			</div>
		</div>
	</main>
</div>

{#if currentMatch}
	{#key currentMatch.match_id}
		<MatchModal
			match={currentMatch}
			tournament={data.tournament}
			{slotLabels}
			{slotUserIds}
			{user}
			onClose={closeMatch}
		/>
	{/key}
{/if}

{#if settingsOpen}
	<TournamentSettingsModal
		tournament={data.tournament}
		onClose={() => (settingsOpen = false)}
	/>
{/if}
