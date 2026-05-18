<script lang="ts">
	import { invalidateAll, pushState } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import {
		ApiError,
		cloudApi,
		type Division,
		type SlotStanding,
		type TournamentMatch,
		type UserMe,
	} from "$lib/api-cloud";
	import ChampionshipBracketTree from "$lib/tournament/ChampionshipBracketTree.svelte";
	import ChampionshipTransitionPreview from "$lib/tournament/ChampionshipTransitionPreview.svelte";
	import MatchModal from "$lib/tournament/MatchModal.svelte";
	import SignupModal from "$lib/tournament/SignupModal.svelte";
	import SlotUsernameAutocomplete from "$lib/tournament/SlotUsernameAutocomplete.svelte";
	import SlotUsernameCell from "$lib/tournament/SlotUsernameCell.svelte";
	import SwissFlowBracket from "$lib/tournament/SwissFlowBracket.svelte";
	import SwissStandings from "$lib/tournament/SwissStandings.svelte";
	import TiebreakerInfoModal from "$lib/tournament/TiebreakerInfoModal.svelte";
	import TournamentConfigurationPanel from "$lib/tournament/TournamentConfigurationPanel.svelte";
	import TournamentMapsPanel from "$lib/tournament/TournamentMapsPanel.svelte";
	import TournamentOverviewPanel from "$lib/tournament/TournamentOverviewPanel.svelte";
	import TournamentSettingsModal from "$lib/tournament/TournamentSettingsModal.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	const isAdmin = $derived(data.tournament.is_viewer_admin === true);
	const user = $derived(page.data.user as UserMe | null);

	// Self-signup state. viewerSlot drives the "you're signed up" strip
	// (non-null → strip + Withdraw); canSignUp drives the "Sign up" CTA
	// (signed-in non-admin who hasn't signed up yet, on a setup-phase
	// tournament with signups open).
	const viewerSlot = $derived(data.tournament.viewer_slot);
	const canSignUp = $derived(
		user !== null &&
			!isAdmin &&
			data.tournament.status === "setup" &&
			data.tournament.signups_open &&
			viewerSlot === null,
	);
	let signupModalOpen = $state(false);

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
		pushState(resolve("/tournaments/[slug]", { slug: data.tournament.slug }), {
			match: null,
		});
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
	// Set by SlotUsernameAutocomplete when the admin picks a real user from
	// the dropdown; cleared if they edit the value afterward. Threads through
	// to the bulk-create payload so the worker pre-links the slot to the
	// canonical user without waiting for an OAuth-callback claim.
	let newSlotUserId = $state<string | null>(null);

	async function addSlot() {
		const username = newSlotUsername.trim();
		if (!username) return;
		const result = await withBusy(
			() =>
				cloudApi.bulkCreateSlots(data.tournament.tournament_id, [
					{
						division: newSlotDivision,
						discord_username: username,
						...(newSlotUserId ? { user_id: newSlotUserId } : {}),
					},
				]),
			`Added ${username} to division ${newSlotDivision}`,
		);
		if (result) {
			newSlotUsername = "";
			newSlotUserId = null;
		}
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

	// Drag-and-drop reorder of swiss-phase slots (setup only). localOrder is
	// a writable derived: it re-projects from slotsA/slotsB whenever server
	// data refreshes, but we can also assign to it directly to show the
	// reorder immediately while the PATCH is in flight. The next data
	// invalidation re-projects and either confirms the optimistic state or
	// (on error rollback) restores the prior order.
	let localOrder: { A: SlotStanding[]; B: SlotStanding[] } = $derived({
		A: [...slotsA],
		B: [...slotsB],
	});

	let dragSlotId = $state<string | null>(null);
	let dragOver = $state<{ division: Division; index: number } | null>(null);

	// Which division the currently-dragged slot lives in. Same-div drops
	// "auto-append" on the last row thanks to the source-removal index shift,
	// so we only need the explicit end-zone for cross-division drags — using
	// this to gate the strip's visibility avoids a useless dashed bar when
	// the source is already in this division.
	const dragSourceDivision = $derived.by((): Division | null => {
		if (!dragSlotId) return null;
		for (const d of ["A", "B"] as const) {
			if (localOrder[d].some((s) => s.slot_id === dragSlotId)) return d;
		}
		return null;
	});

	function onSlotDragStart(slotId: string, e: DragEvent) {
		if (!isAdmin || busy || data.tournament.status !== "setup") {
			e.preventDefault();
			return;
		}
		dragSlotId = slotId;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", slotId);
		}
	}

	// "Drop on row N" = "this slot takes row N's seat; row N and everything
	// after shift down". Cleaner and more reachable than bisect-by-Y, which
	// leaves the bottom-half target a 10px sliver on small rows and makes
	// the last-row's "drop below" impossible to hit. End-zone handles the
	// "append after the last row" case explicitly.
	function onSlotDragOverRow(division: Division, idx: number, e: DragEvent) {
		if (!dragSlotId) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
		dragOver = { division, index: idx };
	}

	function onSlotDragOverEnd(division: Division, e: DragEvent) {
		if (!dragSlotId) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
		dragOver = { division, index: localOrder[division].length };
	}

	function onSlotDragOverEmpty(division: Division, e: DragEvent) {
		if (!dragSlotId) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
		dragOver = { division, index: 0 };
	}

	function onSlotDragEnd() {
		dragSlotId = null;
		dragOver = null;
	}

	async function onSlotDrop(division: Division, e: DragEvent) {
		e.preventDefault();
		if (!dragSlotId || !dragOver) {
			onSlotDragEnd();
			return;
		}
		const slotId = dragSlotId;
		const insertAt = dragOver.index;
		onSlotDragEnd();

		// Pluck the slot from whichever division currently holds it so we can
		// re-insert it at the drop target's index.
		const next: { A: SlotStanding[]; B: SlotStanding[] } = {
			A: [...localOrder.A],
			B: [...localOrder.B],
		};
		let fromDiv: Division | null = null;
		let moved: SlotStanding | undefined;
		for (const d of ["A", "B"] as const) {
			const i = next[d].findIndex((s) => s.slot_id === slotId);
			if (i >= 0) {
				fromDiv = d;
				[moved] = next[d].splice(i, 1);
				break;
			}
		}
		if (!moved || !fromDiv) return;

		// "Take row N's seat" semantics: insert at insertAt directly. Splice
		// clamps insertAt > array.length to "append" automatically, so the
		// end-zone (insertAt = slots.length) works without a special case.
		next[division].splice(insertAt, 0, moved);

		// No-op when the resulting array matches the starting one (e.g.,
		// dropped onto own row, or end-zone with source already at end of
		// same division).
		if (
			fromDiv === division &&
			next[division].length === localOrder[division].length &&
			next[division].every(
				(s, i) => s.slot_id === localOrder[division][i].slot_id,
			)
		) {
			return;
		}

		localOrder = next;
		const divisions = {
			A: next.A.map((s) => s.slot_id),
			B: next.B.map((s) => s.slot_id),
		};
		const result = await withBusy(
			() => cloudApi.reorderSlots(data.tournament.tournament_id, divisions),
			"Reordered slots",
		);
		if (result === null) {
			// Roll back optimistic UI on failure — invalidateAll didn't run, so
			// the resync $effect won't fire on its own.
			localOrder = { A: [...slotsA], B: [...slotsB] };
		}
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

	let transitionPreviewOpen = $state(false);
	let tiebreakerInfoOpen = $state(false);

	async function withdraw() {
		// Plain confirm() — matches the deleteSlot pattern. Non-technical
		// players have seen the OS prompt a thousand times; bespoke modal
		// for a one-action dialog would just be more surface area.
		if (
			!confirm(
				`Withdraw from ${data.tournament.name}? You can sign up again any time before it starts.`,
			)
		) {
			return;
		}
		await withBusy(
			() => cloudApi.withdrawFromTournament(data.tournament.tournament_id),
			"Withdrew from tournament",
		);
	}

	async function transitionChampionship(overrideRanks?: string[]) {
		transitionPreviewOpen = false;
		await withBusy(
			() =>
				cloudApi.transitionChampionship(
					data.tournament.tournament_id,
					overrideRanks ? { override_ranks: overrideRanks } : {},
				),
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

					{#if canSignUp}
						<div class="mt-3 flex flex-wrap items-center justify-end gap-2">
							<button
								type="button"
								class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs text-tan disabled:opacity-50"
								onclick={() => (signupModalOpen = true)}
								disabled={busy}
							>
								Sign up
							</button>
						</div>
					{/if}

					{#if viewerSlot}
						<div
							class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-orange border-opacity-50 px-3 py-2"
							style="background-color: #2a2622;"
							role="status"
						>
							<span class="text-xs text-tan">
								<span class="text-orange">✓</span> You're signed up —
								<span class="font-bold"
									>{viewerSlot.division === "A"
										? data.tournament.division_a_name
										: data.tournament.division_b_name}</span
								>
							</span>
							{#if data.tournament.status === "setup"}
								<button
									type="button"
									class="text-xs text-tan underline opacity-70 transition-colors hover:text-red-400 hover:opacity-100 disabled:opacity-30"
									onclick={withdraw}
									disabled={busy}
								>
									Withdraw
								</button>
							{/if}
						</div>
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
									onclick={() => (transitionPreviewOpen = true)}
									disabled={busy || !transitionReady}
									title={transitionReady
										? ""
										: "All swiss rounds must finish before championship can start"}
								>
									Transition to Championship
								</button>
							{/if}
							{#if data.tournament.status !== "setup"}
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
							{/if}
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
					{#if isAdmin}
						<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
							<TournamentOverviewPanel tournament={data.tournament} />
							<TournamentMapsPanel tournament={data.tournament} />
						</div>
						<TournamentConfigurationPanel
							tournament={data.tournament}
							divACount={slotsA.length}
							divBCount={slotsB.length}
						/>
					{/if}

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
								<label class="block min-w-[14rem] text-xs text-tan">
									Discord username
									<div class="mt-1">
										<SlotUsernameAutocomplete
											value={newSlotUsername}
											onValueChange={(v) => (newSlotUsername = v)}
											onSelectUser={(u) => (newSlotUserId = u?.user_id ?? null)}
											disabled={busy}
											onEnter={() => {
												if (!busy && newSlotUsername.trim()) addSlot();
											}}
											inputAttrs={{
												"data-1p-ignore": "true",
												"data-lpignore": "true",
												"data-bwignore": "true",
												"data-form-type": "other",
											}}
										/>
									</div>
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
								{#if data.tournament.signups_open}
									Players will appear here as they sign up.
								{:else}
									The tournament hasn't started yet. Players will appear here as
									they're added.
								{/if}
							</p>
						{/if}

						<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
							{#each ["A", "B"] as const as div (div)}
								{@const slots = localOrder[div]}
								{@const draggable = isAdmin && !busy}
								<div class="rounded-lg p-3" style="background-color: #35302B;">
									<h3 class="mb-2 text-xs uppercase text-tan opacity-70">
										{data.standings.divisions[div].name}
									</h3>
									{#if slots.length === 0}
										<p
											class="text-xs text-tan opacity-50"
											class:outline={isAdmin &&
												dragSlotId &&
												dragOver?.division === div}
											class:outline-orange={isAdmin &&
												dragSlotId &&
												dragOver?.division === div}
											ondragover={(e) => onSlotDragOverEmpty(div, e)}
											ondrop={(e) => onSlotDrop(div, e)}
											role="presentation"
										>
											No slots yet.
										</p>
									{:else}
										<table class="w-full text-xs text-tan">
											<thead>
												<tr class="border-b border-black">
													{#if isAdmin}
														<th class="w-4"></th>
													{/if}
													<th class="py-1 pr-2 text-left">#</th>
													<th class="py-1 pr-2 text-left">Username</th>
													<th class="py-1 text-right">Claimed</th>
													{#if isAdmin}
														<th class="py-1 pl-2 text-right"></th>
													{/if}
												</tr>
											</thead>
											<tbody>
												{#each slots as s, idx (s.slot_id)}
													{@const showRowTarget =
														dragSlotId !== null &&
														dragSlotId !== s.slot_id &&
														dragOver?.division === div &&
														dragOver.index === idx}
													<tr
														class="border-b border-black border-opacity-30 last:border-0"
														class:opacity-40={dragSlotId === s.slot_id}
														class:bg-orange={showRowTarget}
														class:bg-opacity-20={showRowTarget}
														draggable={draggable ? "true" : "false"}
														ondragstart={(e) => onSlotDragStart(s.slot_id, e)}
														ondragend={onSlotDragEnd}
														ondragover={(e) => onSlotDragOverRow(div, idx, e)}
														ondrop={(e) => onSlotDrop(div, e)}
													>
														{#if isAdmin}
															<td
																class="select-none py-1 pr-1 text-center text-tan opacity-40"
																class:cursor-grab={draggable}
																aria-label="Drag to reorder"
															>
																⋮⋮
															</td>
														{/if}
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
										{#if isAdmin && dragSlotId && dragSourceDivision !== div}
											{@const showEndTarget =
												dragOver?.division === div &&
												dragOver.index === slots.length}
											<div
												class="mt-1 rounded border border-dashed py-2"
												class:border-orange={showEndTarget}
												class:bg-orange={showEndTarget}
												class:bg-opacity-20={showEndTarget}
												class:border-black={!showEndTarget}
												class:opacity-60={!showEndTarget}
												ondragover={(e) => onSlotDragOverEnd(div, e)}
												ondrop={(e) => onSlotDrop(div, e)}
												role="presentation"
											></div>
										{/if}
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

					{#each ["A", "B"] as const as division (division)}
						{@const divisionData = data.standings.divisions[division]}
						{#if divisionData.standings.length > 0}
							<section class="mb-8">
								<h2
									class="mb-3 flex items-baseline gap-2 text-lg font-bold text-tan"
								>
									<span>{divisionData.name}</span>
									<button
										type="button"
										class="rounded border border-black border-opacity-50 px-1.5 text-[11px] font-normal text-tan opacity-60 transition-opacity hover:opacity-100"
										onclick={() => (tiebreakerInfoOpen = true)}
										aria-label="How tiebreakers and qualification work"
										title="How tiebreakers and qualification work"
									>
										?
									</button>
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
										mapScriptOptions={data.tournament.map_script_options}
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

{#if signupModalOpen && user}
	<SignupModal
		tournament={data.tournament}
		{user}
		onClose={() => (signupModalOpen = false)}
	/>
{/if}

{#if transitionPreviewOpen && data.standings.combined_qualifier_ranking}
	<ChampionshipTransitionPreview
		tournament={data.tournament}
		combined={data.standings.combined_qualifier_ranking}
		{busy}
		onConfirm={transitionChampionship}
		onCancel={() => (transitionPreviewOpen = false)}
	/>
{/if}

{#if tiebreakerInfoOpen}
	<TiebreakerInfoModal onClose={() => (tiebreakerInfoOpen = false)} />
{/if}
