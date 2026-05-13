<script lang="ts">
	import { invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import {
		ApiError,
		cloudApi,
		type Division,
		type TournamentMatch,
	} from "$lib/api-cloud";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import RoundMatches from "$lib/tournament/RoundMatches.svelte";
	import SlotUsernameCell from "$lib/tournament/SlotUsernameCell.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let busy = $state(false);
	let banner = $state<{ kind: "ok" | "err"; message: string } | null>(null);

	// Slot identity lookup so we can show usernames against slot_ids.
	const slotInfo = $derived.by(() => {
		const out: Record<
			string,
			{
				username: string | null;
				user_id: string | null;
				division: Division | null;
				phase: "swiss" | "championship";
				swiss_seed: number | null;
			}
		> = {};
		for (const div of ["A", "B"] as const) {
			for (const s of data.standings.divisions[div].standings) {
				out[s.slot_id] = {
					username: s.discord_username,
					user_id: s.user_id,
					division: div,
					phase: "swiss",
					swiss_seed: null,
				};
			}
		}
		for (const s of data.bracket.slots) {
			out[s.slot_id] = {
				username: s.discord_username,
				user_id: s.user_id,
				division: null,
				phase: "championship",
				swiss_seed: null,
			};
		}
		return out;
	});

	function slotLabel(slotId: string | null): string {
		if (!slotId) return "BYE";
		return slotInfo[slotId]?.username ?? `slot ${slotId.slice(0, 6)}`;
	}

	function swissSlotRows(division: Division) {
		return data.standings.divisions[division].standings.map((s) => ({
			slot_id: s.slot_id,
			username: s.discord_username,
			user_id: s.user_id,
			wins: s.wins,
			losses: s.losses,
			// Show the slot's swiss_seed (admin-assigned order) in the # column
			// rather than the cascade rank, which is meaningless in setup
			// (everyone tied at 0-0) and noisy during play. Falls back to rank
			// if seed is unset for some reason.
			number: s.swiss_seed ?? s.rank,
		}));
	}

	// Group rounds by phase + division for the rounds section.
	const swissRoundsA = $derived(
		data.rounds
			.filter((r) => r.phase === "swiss" && r.division === "A")
			.sort((a, b) => a.round_number - b.round_number),
	);
	const swissRoundsB = $derived(
		data.rounds
			.filter((r) => r.phase === "swiss" && r.division === "B")
			.sort((a, b) => a.round_number - b.round_number),
	);
	const champRounds = $derived(
		data.rounds
			.filter((r) => r.phase === "championship")
			.sort((a, b) => a.round_number - b.round_number),
	);

	const matchesByRound = $derived.by(() => {
		const out: Record<string, TournamentMatch[]> = {};
		for (const m of data.matches) {
			if (!m.round_id) continue;
			(out[m.round_id] ??= []).push(m);
		}
		return out;
	});

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

	// --- Tournament settings (name, description, division names) ---

	let settingsOpen = $state(false);
	// Initialise from `data` at component construction; the $effect below
	// re-syncs after invalidateAll() loads a fresh tournament row. Svelte's
	// state_referenced_locally warning doesn't apply since the re-sync is
	// the explicit reactive path.
	// svelte-ignore state_referenced_locally
	let editName = $state(data.tournament.name);
	// svelte-ignore state_referenced_locally
	let editDescription = $state(data.tournament.description ?? "");
	// svelte-ignore state_referenced_locally
	let editDivAName = $state(data.tournament.division_a_name);
	// svelte-ignore state_referenced_locally
	let editDivBName = $state(data.tournament.division_b_name);

	// Re-sync the edit fields when the underlying tournament changes (e.g.
	// after a successful save reloads the page data).
	$effect(() => {
		editName = data.tournament.name;
		editDescription = data.tournament.description ?? "";
		editDivAName = data.tournament.division_a_name;
		editDivBName = data.tournament.division_b_name;
	});

	async function saveSettings() {
		const patch: Record<string, string | null> = {};
		if (editName.trim() !== data.tournament.name) patch.name = editName.trim();
		if ((editDescription.trim() || null) !== data.tournament.description)
			patch.description = editDescription.trim() || null;
		if (editDivAName.trim() !== data.tournament.division_a_name)
			patch.division_a_name = editDivAName.trim();
		if (editDivBName.trim() !== data.tournament.division_b_name)
			patch.division_b_name = editDivBName.trim();
		if (Object.keys(patch).length === 0) {
			settingsOpen = false;
			return;
		}
		await withBusy(
			() => cloudApi.patchTournament(data.tournament.tournament_id, patch),
			"Settings saved",
		);
		settingsOpen = false;
	}

	// --- Slot management ---

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

	async function deleteSlot(slotId: string) {
		if (!confirm(`Delete slot ${slotLabel(slotId)}?`)) return;
		await withBusy(
			() => cloudApi.deleteSlot(data.tournament.tournament_id, slotId),
			"Deleted slot",
		);
	}

	// --- Lifecycle ---

	async function startSwiss() {
		if (
			!confirm(
				"Start Swiss phase? This locks the slot list and computes advance count.",
			)
		)
			return;
		await withBusy(
			() => cloudApi.startSwiss(data.tournament.tournament_id),
			"Started Swiss",
		);
	}

	// Generate the next Swiss round for both divisions in one shot. Divisions
	// can technically diverge (one finishes a round before the other), but in
	// practice admins want them in lockstep. If one division has an open
	// prior round and the other doesn't, we'll partial-succeed and show
	// which division failed — admin can then close the laggard and retry.
	async function generateRound() {
		busy = true;
		banner = null;
		const errors: string[] = [];
		let succeeded = 0;
		try {
			for (const div of ["A", "B"] as const) {
				try {
					await cloudApi.generateRound(data.tournament.tournament_id, {
						division: div,
					});
					succeeded++;
				} catch (err) {
					if (err instanceof ApiError) {
						errors.push(
							`${data.standings.divisions[div].name}: ${err.message}${err.code ? ` (${err.code})` : ""}`,
						);
					} else {
						errors.push(`${data.standings.divisions[div].name}: failed`);
					}
				}
			}
			await invalidateAll();
			if (errors.length === 0) {
				banner = { kind: "ok", message: "Generated next round" };
			} else if (succeeded === 0) {
				banner = { kind: "err", message: errors.join(" · ") };
			} else {
				banner = {
					kind: "err",
					message: `Partial: ${succeeded} generated, ${errors.join(" · ")}`,
				};
			}
		} finally {
			busy = false;
		}
	}

	async function generateChampRound() {
		await withBusy(
			() => cloudApi.generateRound(data.tournament.tournament_id, {}),
			"Generated next championship round",
		);
	}

	async function startRound(roundId: string) {
		await withBusy(
			() => cloudApi.startRound(data.tournament.tournament_id, roundId),
			"Round started",
		);
	}

	async function transitionChampionship() {
		if (
			!confirm(
				"Transition to championship? Builds the bracket from Swiss results.",
			)
		)
			return;
		await withBusy(
			() => cloudApi.transitionChampionship(data.tournament.tournament_id),
			"Transitioned to championship",
		);
	}

	async function completeTournament() {
		if (
			!confirm("Mark the tournament complete? This freezes all admin actions.")
		)
			return;
		await withBusy(
			() => cloudApi.completeTournament(data.tournament.tournament_id),
			"Tournament marked complete",
		);
	}

	// --- Per-match admin actions ---

	let pairingEditMatchId = $state<string | null>(null);
	let pairingMapInput = $state("");

	function openPairingEdit(match: TournamentMatch) {
		pairingEditMatchId = match.match_id;
		pairingMapInput = match.map_script ?? "";
	}

	async function savePairing(matchId: string) {
		await withBusy(
			() =>
				cloudApi.patchPairing(data.tournament.tournament_id, matchId, {
					map_script: pairingMapInput || undefined,
				}),
			"Pairing updated",
		);
		pairingEditMatchId = null;
	}

	let retroEditMatchId = $state<string | null>(null);
	let retroWinnerSlotId = $state<string | null>(null);
	let retroStatus = $state<"reported" | "forfeit" | "pending">("reported");

	function openRetroEdit(match: TournamentMatch) {
		retroEditMatchId = match.match_id;
		retroWinnerSlotId = match.winner_slot_id;
		retroStatus =
			(match.status as "reported" | "forfeit" | "pending") ?? "reported";
	}

	async function saveRetroEdit(matchId: string) {
		await withBusy(
			() =>
				cloudApi.retroEditMatch(data.tournament.tournament_id, matchId, {
					winner_slot_id: retroWinnerSlotId,
					status: retroStatus,
				}),
			"Match edited",
		);
		retroEditMatchId = null;
	}

	function statusBadgeClass(status: string): string {
		if (status === "complete" || status === "reported" || status === "bye")
			return "text-orange";
		if (status === "in_progress") return "text-orange opacity-80";
		return "text-tan opacity-60";
	}
</script>

<div class="flex flex-1 overflow-hidden">
	<main class="isolate flex flex-1 flex-col overflow-hidden">
		<div
			class="cloud-scroll flex-1 overflow-y-auto px-4 pb-8 pt-4"
			use:autohideScroll
		>
			<div class="mx-auto max-w-5xl">
				<header class="mb-4 flex items-baseline justify-between gap-3">
					<div>
						<nav class="text-xs text-tan opacity-70">
							<a
								class="hover:text-orange hover:opacity-100"
								href={resolve("/tournaments/[slug]", {
									slug: data.tournament.slug,
								})}
							>
								← {data.tournament.name}
							</a>
						</nav>
						<h1 class="mt-1 text-2xl font-bold text-tan">Admin panel</h1>
					</div>
					<span
						class="whitespace-nowrap rounded border border-orange px-2 py-0.5 text-xs uppercase text-orange"
					>
						{data.tournament.status}
					</span>
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

				<!-- Settings -->
				<section class="mb-6 rounded-lg p-4" style="background-color: #2a2622;">
					<div class="mb-3 flex items-baseline justify-between gap-3">
						<h2 class="text-sm font-bold text-tan">Settings</h2>
						<button
							type="button"
							class="text-xs text-tan opacity-70 hover:text-orange hover:opacity-100"
							onclick={() => (settingsOpen = !settingsOpen)}
						>
							{settingsOpen ? "Cancel" : "Edit"}
						</button>
					</div>
					<div class="rounded-lg p-3" style="background-color: #35302B;">
						{#if !settingsOpen}
							<div
								class="grid grid-cols-1 gap-1 text-xs text-tan lg:grid-cols-2"
							>
								<div>
									<span class="opacity-60">Name:</span>
									{data.tournament.name}
								</div>
								<div>
									<span class="opacity-60">Slug:</span>
									{data.tournament.slug}
								</div>
								<div>
									<span class="opacity-60">Division A:</span>
									{data.tournament.division_a_name}
								</div>
								<div>
									<span class="opacity-60">Division B:</span>
									{data.tournament.division_b_name}
								</div>
								{#if data.tournament.description}
									<div class="lg:col-span-2">
										<span class="opacity-60">Description:</span>
										{data.tournament.description}
									</div>
								{/if}
							</div>
						{:else}
							<div class="flex flex-col gap-2 text-xs text-tan">
								<label>
									Name
									<input
										type="text"
										bind:value={editName}
										class="mt-1 block w-full rounded border border-black bg-blue-gray p-1.5"
									/>
								</label>
								<label>
									Description
									<textarea
										bind:value={editDescription}
										rows="2"
										class="mt-1 block w-full rounded border border-black bg-blue-gray p-1.5"
									></textarea>
								</label>
								<div class="grid grid-cols-1 gap-2 lg:grid-cols-2">
									<label>
										Division A name
										<input
											type="text"
											bind:value={editDivAName}
											class="mt-1 block w-full rounded border border-black bg-blue-gray p-1.5"
										/>
									</label>
									<label>
										Division B name
										<input
											type="text"
											bind:value={editDivBName}
											class="mt-1 block w-full rounded border border-black bg-blue-gray p-1.5"
										/>
									</label>
								</div>
								<div class="mt-1 flex justify-end">
									<button
										type="button"
										class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs text-tan disabled:opacity-50"
										onclick={saveSettings}
										disabled={busy}
									>
										Save
									</button>
								</div>
							</div>
						{/if}
					</div>
				</section>

				<!-- Lifecycle controls -->
				<section class="mb-6 rounded-lg p-4" style="background-color: #2a2622;">
					<h2 class="mb-3 text-sm font-bold text-tan">Lifecycle</h2>
					<div
						class="flex flex-wrap gap-2 rounded-lg p-3"
						style="background-color: #35302B;"
					>
						{#if data.tournament.status === "setup"}
							<button
								type="button"
								class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs text-tan disabled:opacity-50"
								onclick={startSwiss}
								disabled={busy}
							>
								Start Swiss
							</button>
						{:else if data.tournament.status === "swiss"}
							<button
								type="button"
								class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs text-tan disabled:opacity-50"
								onclick={transitionChampionship}
								disabled={busy}
							>
								Transition to Championship
							</button>
						{:else if data.tournament.status === "championship"}
							<button
								type="button"
								class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs text-tan disabled:opacity-50"
								onclick={completeTournament}
								disabled={busy}
							>
								Mark Complete
							</button>
						{:else}
							<p class="text-xs text-tan opacity-70">
								Tournament is complete — no further admin actions.
							</p>
						{/if}
					</div>
					{#if data.tournament.swiss_advance_count !== null}
						<p class="mt-2 text-xs text-tan opacity-70">
							Swiss advance count: {data.tournament.swiss_advance_count} per division
						</p>
					{/if}
				</section>

				<!-- Slots -->
				<section class="mb-6 rounded-lg p-4" style="background-color: #2a2622;">
					<h2 class="mb-3 text-sm font-bold text-tan">Slots</h2>

					{#if data.tournament.status === "setup"}
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
					{/if}

					<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
						{#each ["A", "B"] as Division[] as div (div)}
							<div class="rounded-lg p-3" style="background-color: #35302B;">
								<h3 class="mb-2 text-xs uppercase text-tan opacity-70">
									{data.standings.divisions[div].name}
								</h3>
								<table class="w-full text-xs text-tan">
									<thead>
										<tr class="border-b border-black">
											<th class="py-1 pr-2 text-left">#</th>
											<th class="py-1 pr-2 text-left">Username</th>
											<th class="py-1 pr-2 text-right">Claimed</th>
											<th class="py-1 text-right">W-L</th>
											{#if data.tournament.status === "setup"}
												<th class="py-1 text-right"></th>
											{/if}
										</tr>
									</thead>
									<tbody>
										{#each swissSlotRows(div) as row (row.slot_id)}
											<tr
												class="border-b border-black border-opacity-30 last:border-0"
											>
												<td class="py-1 pr-2 font-mono">{row.number}</td>
												<td class="py-1 pr-2">
													<SlotUsernameCell
														slotId={row.slot_id}
														username={row.username}
														disabled={busy}
														onSubstitute={(u) => substituteSlot(row.slot_id, u)}
													/>
												</td>
												<td class="py-1 pr-2 text-right">
													{row.user_id ? "✓" : "—"}
												</td>
												<td class="py-1 text-right font-mono">
													{row.wins}-{row.losses}
												</td>
												{#if data.tournament.status === "setup"}
													<td class="py-1 text-right">
														<button
															type="button"
															class="text-xs text-tan opacity-50 hover:text-red-400 hover:opacity-100"
															onclick={() => deleteSlot(row.slot_id)}
															disabled={busy}
														>
															×
														</button>
													</td>
												{/if}
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/each}
					</div>
				</section>

				<!-- Rounds -->
				{#if data.tournament.status !== "setup"}
					<section
						class="mb-6 rounded-lg p-4"
						style="background-color: #2a2622;"
					>
						<h2 class="mb-3 text-sm font-bold text-tan">Rounds</h2>

						{#if data.tournament.status === "swiss"}
							<div class="mb-3">
								<button
									type="button"
									class="rounded border border-brown px-3 py-1.5 text-xs text-tan hover:bg-brown disabled:opacity-50"
									onclick={generateRound}
									disabled={busy}
								>
									Generate next round
								</button>
								<p class="mt-2 text-xs text-tan opacity-60">
									Once a round is started, players report results from each
									match's page. You can also record results inline below.
								</p>
							</div>
						{/if}

						{#if data.tournament.status === "championship"}
							<div class="mb-3">
								<button
									type="button"
									class="rounded border border-brown px-3 py-1.5 text-xs text-tan hover:bg-brown disabled:opacity-50"
									onclick={generateChampRound}
									disabled={busy}
								>
									Generate next championship round
								</button>
							</div>
						{/if}

						{#each [{ label: data.standings.divisions.A.name, rounds: swissRoundsA }, { label: data.standings.divisions.B.name, rounds: swissRoundsB }, { label: "Championship", rounds: champRounds }] as group (group.label)}
							{#if group.rounds.length > 0}
								<div class="mb-4">
									<h3 class="mb-2 text-xs uppercase text-tan opacity-70">
										{group.label}
									</h3>
									<div class="flex flex-col gap-3">
										{#each group.rounds as round (round.round_id)}
											<div class="rounded border border-black bg-[#35302b] p-3">
												<div
													class="mb-2 flex items-baseline justify-between gap-2"
												>
													<h4 class="text-xs font-bold text-tan">
														Round {round.round_number}
														<span
															class="ml-2 text-[10px] font-normal {statusBadgeClass(
																round.status,
															)}"
														>
															{round.status}
														</span>
													</h4>
													<div class="flex gap-1">
														{#if round.status === "pending"}
															<button
																type="button"
																class="hover:bg-orange/20 rounded border border-orange px-2 py-0.5 text-[10px] text-tan disabled:opacity-50"
																onclick={() => startRound(round.round_id)}
																disabled={busy}
															>
																Start
															</button>
														{/if}
													</div>
												</div>

												<RoundMatches
													matches={matchesByRound[round.round_id] ?? []}
													{round}
													tournamentSlug={data.tournament.slug}
													{slotLabel}
													{busy}
													{pairingEditMatchId}
													{pairingMapInput}
													onOpenPairingEdit={openPairingEdit}
													onSavePairing={savePairing}
													onCancelPairingEdit={() =>
														(pairingEditMatchId = null)}
													onMapInput={(v) => (pairingMapInput = v)}
													{retroEditMatchId}
													{retroWinnerSlotId}
													{retroStatus}
													onOpenRetroEdit={openRetroEdit}
													onSaveRetroEdit={saveRetroEdit}
													onCancelRetroEdit={() => (retroEditMatchId = null)}
													onRetroWinner={(v) => (retroWinnerSlotId = v)}
													onRetroStatus={(v) => (retroStatus = v)}
												/>
											</div>
										{/each}
									</div>
								</div>
							{/if}
						{/each}
					</section>
				{/if}
			</div>
		</div>
	</main>
</div>
