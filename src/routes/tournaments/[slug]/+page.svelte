<script lang="ts">
	import { untrack } from "svelte";
	import { fade } from "svelte/transition";
	import { goto, invalidateAll, pushState } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { autohideScroll } from "$lib/actions/autohideScroll";
	import { type Crumb } from "$lib/Breadcrumb.svelte";
	import {
		ApiError,
		cloudApi,
		type Division,
		type SlotStanding,
		type TournamentMatch,
		type UserMe,
	} from "$lib/api-cloud";
	import { synthesizeChampionshipPlaceholders } from "$lib/tournament/bracket-placeholders";
	import ChampionshipBracketTree from "$lib/tournament/ChampionshipBracketTree.svelte";
	import ChampionshipStandings from "$lib/tournament/ChampionshipStandings.svelte";
	import PickPreferenceNote from "$lib/tournament/PickPreferenceNote.svelte";
	import MatchPopover from "$lib/tournament/MatchPopover.svelte";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
	import UserAutocomplete from "$lib/tournament/UserAutocomplete.svelte";
	import SlotUsernameCell from "$lib/tournament/SlotUsernameCell.svelte";
	import SwissFlowBracket from "$lib/tournament/SwissFlowBracket.svelte";
	import SwissStandings from "$lib/tournament/SwissStandings.svelte";
	import TournamentHeader from "$lib/tournament/TournamentHeader.svelte";
	import { buildSlotMaps } from "$lib/tournament/slot-identity";
	import {
		headerStatusMeta,
		type HeaderHero,
	} from "$lib/tournament/header-status";
	import { mapScriptLabel } from "$lib/tournament/map-scripts";
	import {
		distinguishingOptions,
		mapPoolLabel,
		poolEntryById,
	} from "$lib/tournament/map-script-options";
	import TournamentConfigurationPanel from "$lib/tournament/TournamentConfigurationPanel.svelte";
	import TournamentMapsPanel from "$lib/tournament/TournamentMapsPanel.svelte";
	import TournamentOverviewPanel from "$lib/tournament/TournamentOverviewPanel.svelte";
	import Popover from "$lib/ui/Popover.svelte";
	import { Tabs } from "bits-ui";
	import { confirmDialog } from "$lib/ui/confirm";
	import { toast } from "$lib/ui/toast";
	import RadioGroup from "$lib/ui/RadioGroup.svelte";
	import RadioItem from "$lib/ui/RadioItem.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	// Canonical trail: Home › Tournaments › this tournament.
	const crumbs: Crumb[] = $derived([
		{ label: "Home", href: resolve("/") },
		{ label: "Tournaments", href: resolve("/tournaments") },
		{ label: data.tournament.name },
	]);

	// Open the shared guide page, carrying this tournament as the origin so the
	// guide's breadcrumb can link back here (see tournaments/guide/+page.svelte).
	function openGuide() {
		const dest = `${resolve("/tournaments/guide")}?from=${data.tournament.slug}&name=${encodeURIComponent(data.tournament.name)}`;
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- query string appended to a resolved path
		goto(dest);
	}

	const isAdmin = $derived(data.tournament.is_viewer_admin === true);
	const user = $derived(page.data.user as UserMe | null);

	// Per-division Swiss view toggle: the bracket diagram and the standings table
	// occupy one card and are switched (not stacked) to tighten the page. Each
	// division keeps its own selection so A and B flip independently.
	// Once the championship is under way the Swiss rounds are settled, so the
	// standings are the more useful default for each group; the live bracket is
	// still one toggle away. untrack: this is a one-time initial default, not a
	// reactive binding (a later phase change shouldn't yank a user's toggle).
	const defaultSwissView = untrack(() =>
		data.tournament.status === "championship" ? "standings" : "diagram",
	);
	let swissView = $state<Record<Division, "diagram" | "standings">>({
		A: defaultSwissView,
		B: defaultSwissView,
	});
	let championshipView = $state<"diagram" | "standings">("diagram");
	// Segmented switch: the triggers are transparent text laid over a sliding
	// highlight thumb (see each Tabs.List), so the lit surface-raised segment animates
	// across rather than the fill swapping. text-center + the grid-cols-2 track
	// keep both halves equal width so the half-width thumb lands on each.
	const viewTriggerClass =
		"relative z-10 cursor-pointer px-3 py-1.5 text-center text-xs font-bold text-tan transition-colors";

	// Self-signup state. viewerSlot drives the "you're signed up" strip
	// (non-null → strip + Withdraw); canSignUp drives the "Sign up" CTA
	// (any signed-in viewer who hasn't signed up yet, on a setup-phase
	// tournament with signups open). Admins are included so they can sign
	// themselves up and preview the signup form; the backend signup handler
	// imposes no admin restriction either.
	const viewerSlot = $derived(data.tournament.viewer_slot);
	const canSignUp = $derived(
		user !== null &&
			data.tournament.status === "setup" &&
			data.tournament.signups_open &&
			viewerSlot === null,
	);

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
	// championship phase. Consumed by the match popover and slotLabelFor.
	const slotMaps = $derived(buildSlotMaps(data.standings, data.bracket));
	const slotLabels = $derived(slotMaps.labels);
	const slotUserIds = $derived(slotMaps.userIds);
	const slotAvatars = $derived(slotMaps.avatars);

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
	// Client-synthesized placeholder cells for future championship rounds the
	// backend hasn't generated yet (final between two semis before both
	// semis report, etc.). Keyed by synthetic match_id so currentMatch can
	// find them.
	const placeholderById = $derived.by(() => {
		const out: Record<string, TournamentMatch> = {};
		for (const m of synthesizeChampionshipPlaceholders(data.bracket)) {
			out[m.match_id] = m;
		}
		return out;
	});
	const currentMatch = $derived(
		openMatchId
			? (data.matches.find((m) => m.match_id === openMatchId) ??
					placeholderById[openMatchId] ??
					null)
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

	// Side the match popover opens toward: away from the clicked cell. A cell in
	// the left half of the viewport opens the popover to its right and vice
	// versa, so the detail never covers the part of the bracket you're looking
	// at. floating-ui still flips as a fallback when the chosen side won't fit.
	let matchSide = $state<"left" | "right">("right");
	$effect(() => {
		if (!openMatchId) return;
		const el = document.querySelector(`[data-match-id="${openMatchId}"]`);
		if (!(el instanceof HTMLElement)) return;
		const rect = el.getBoundingClientRect();
		const cellCenter = rect.left + rect.width / 2;
		matchSide = cellCenter < window.innerWidth / 2 ? "right" : "left";
	});

	// --- Admin action surface: busy gate + toast feedback + handlers.

	let busy = $state(false);

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

	// --- Header: status chip + per-status hero strip.

	const statusMeta = $derived(
		headerStatusMeta(data.tournament.status, data.tournament.signups_open),
	);

	// Roster size for the meta strip, mirroring the list endpoint's phase rule:
	// championship/complete count the bracket, otherwise the swiss roster.
	const playerCount = $derived(
		data.tournament.status === "championship" ||
			data.tournament.status === "complete"
			? data.tournament.slot_counts.championship ||
					data.tournament.slot_counts.swiss
			: data.tournament.slot_counts.swiss,
	);

	// Final-match outcome for the champion card. The final is the highest-
	// numbered championship round's decisive match; its winner is the champion
	// and the other slot the runner-up. Null fields until a winner is recorded.
	const championshipFinal = $derived.by(
		(): {
			champion: string | null;
			finalist: string | null;
			finalSummary: string | null;
		} => {
			const rounds = data.bracket.rounds;
			const empty = { champion: null, finalist: null, finalSummary: null };
			if (rounds.length === 0) return empty;
			const finalRound = rounds.reduce((a, b) =>
				b.round_number > a.round_number ? b : a,
			);
			const finalMatch =
				finalRound.matches.find((m) => m.winner_slot_id) ??
				finalRound.matches[0] ??
				null;
			if (!finalMatch?.winner_slot_id) return empty;
			const loserId =
				finalMatch.slot_a_id === finalMatch.winner_slot_id
					? finalMatch.slot_b_id
					: finalMatch.slot_a_id;

			// "Won the final on <map>[ in N turns]". Map name resolves from the
			// final's assigned pool instance (falling back to the bare script
			// label); the turn count only exists when a game was uploaded.
			const entry = poolEntryById(
				data.tournament.map_pool,
				finalMatch.map_pool_id,
			);
			const mapName = entry
				? mapPoolLabel(
						entry,
						distinguishingOptions(data.tournament.map_pool),
						false,
					)
				: finalMatch.map_script
					? mapScriptLabel(finalMatch.map_script)
					: null;
			const turns = finalMatch.total_turns ?? null;
			let finalSummary = "Won the final";
			if (mapName) finalSummary += ` on ${mapName}`;
			if (turns != null)
				finalSummary += ` in ${turns} turn${turns === 1 ? "" : "s"}`;

			return {
				champion: slotLabelFor(finalMatch.winner_slot_id),
				finalist: loserId ? slotLabelFor(loserId) : null,
				finalSummary,
			};
		},
	);

	// Rounds-completed measure for a phase: fully-finished rounds count 1 each,
	// plus the reported fraction of the first still-open round. Rounds generate
	// progressively, so the first incomplete round is the current one and there
	// are no later rounds to count. Used to fill each half of the overall bar.
	function effectiveRoundsDone(
		matches: { round_number?: number | null; status: string }[],
	): number {
		const byRound: Record<number, { total: number; done: number }> = {};
		for (const m of matches) {
			const r = m.round_number ?? 0;
			const e = (byRound[r] ??= { total: 0, done: 0 });
			e.total++;
			if (m.status !== "pending") e.done++;
		}
		let done = 0;
		for (const r of Object.keys(byRound)
			.map(Number)
			.sort((a, b) => a - b)) {
			const e = byRound[r];
			if (e.total > 0 && e.done === e.total) {
				done += 1;
			} else {
				done += e.total > 0 ? e.done / e.total : 0;
				break;
			}
		}
		return done;
	}

	const hero = $derived.by((): HeaderHero => {
		const t = data.tournament;
		switch (statusMeta.key) {
			case "setup":
				return { kind: "setup" };
			case "signups":
				return {
					kind: "signups",
					signedUp: t.slot_counts.swiss,
					divisionAName: t.division_a_name,
					divisionACount: t.slot_counts.swiss_by_division.A,
					divisionBName: t.division_b_name,
					divisionBCount: t.slot_counts.swiss_by_division.B,
				};
			case "complete":
				return {
					kind: "complete",
					...championshipFinal,
					fieldSize: data.bracket.slots.length,
				};
			case "in-progress": {
				// Championship: progress walks the generated bracket rounds; total
				// rounds is the bracket depth (ceil log2 of the bracket size). The
				// overall bar starts at 0.5 (Swiss done) and fills its back half by
				// bracket-round completion.
				if (t.status === "championship") {
					const rounds = data.bracket.rounds;
					const current = rounds.reduce(
						(a, b) => (b.round_number > a.round_number ? b : a),
						rounds[0],
					);
					const matches = current?.matches ?? [];
					const slotCount = data.bracket.slots.length;
					const depth =
						slotCount > 1 ? Math.ceil(Math.log2(slotCount)) : rounds.length;
					const round = current?.round_number ?? 1;
					const champMatches = rounds.flatMap((rd) =>
						rd.matches.map((m) => ({
							round_number: rd.round_number,
							status: m.status,
						})),
					);
					const champFraction =
						depth > 0
							? Math.min(1, effectiveRoundsDone(champMatches) / depth)
							: 0;
					return {
						kind: "in-progress",
						phaseLabel: "Championship",
						round,
						totalRounds: Math.max(depth, round),
						reported: matches.filter((m) => m.status !== "pending").length,
						total: matches.length,
						overall: 0.5 + champFraction * 0.5,
					};
				}
				// Swiss: both divisions advance in lockstep, so the current round is
				// the highest round number present across either division. The overall
				// bar fills its front half (0–0.5) by Swiss-round completion.
				const swiss = data.matches.filter((m) => m.phase === "swiss");
				const round =
					swiss.reduce((acc, m) => Math.max(acc, m.round_number ?? 0), 0) || 1;
				const inRound = swiss.filter((m) => m.round_number === round);
				const swissFraction =
					t.swiss_max_rounds > 0
						? Math.min(1, effectiveRoundsDone(swiss) / t.swiss_max_rounds)
						: 0;
				return {
					kind: "in-progress",
					phaseLabel: "Swiss",
					round,
					totalRounds: t.swiss_max_rounds,
					reported: inRound.filter((m) => m.status !== "pending").length,
					total: inRound.length,
					overall: swissFraction * 0.5,
				};
			}
		}
	});

	async function withBusy<T>(
		op: () => Promise<T>,
		successMessage?: string,
	): Promise<T | null> {
		busy = true;
		try {
			const out = await op();
			if (successMessage) toast.info(successMessage);
			await invalidateAll();
			return out;
		} catch (err) {
			let message = "Action failed";
			if (err instanceof ApiError) {
				message = err.message + (err.code ? ` (${err.code})` : "");
			}
			toast.error(message);
			return null;
		} finally {
			busy = false;
		}
	}

	let newSlotUsername = $state("");
	let newSlotDivision = $state<Division>("A");
	// Set by UserAutocomplete when the admin picks a real user from
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

	async function substituteSlot(
		slotId: string,
		newUsername: string,
		userId: string | null = null,
		// signup answer edited alongside the username on the slots panel.
		// undefined leaves the column untouched (the Swiss-standings call site
		// omits it); null clears it.
		answer?: string | null,
	) {
		if (!newUsername.trim()) return;
		await withBusy(
			() =>
				cloudApi.patchSlot(data.tournament.tournament_id, slotId, {
					discord_username: newUsername.trim(),
					...(userId ? { user_id: userId } : {}),
					...(answer !== undefined ? { signup_answer: answer } : {}),
				}),
			`Substituted slot to ${newUsername}`,
		);
	}

	function slotLabelFor(slotId: string): string {
		return slotLabels[slotId] ?? `slot ${slotId.slice(0, 6)}`;
	}

	async function deleteSlot(slotId: string) {
		if (
			!(await confirmDialog({
				title: "Delete slot",
				message: `Delete slot ${slotLabelFor(slotId)}?`,
				confirmLabel: "Delete",
				destructive: true,
			}))
		)
			return;
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
			!(await confirmDialog({
				title: "Start tournament",
				message:
					"Start the tournament? Locks the slot list and generates Round 1 for both divisions.",
				confirmLabel: "Start",
			}))
		)
			return;
		await withBusy(
			() => cloudApi.startTournament(data.tournament.tournament_id),
			"Started tournament",
		);
	}

	// Invoked from the "Signed up" popover, whose explicit Withdraw button is the
	// deliberate confirmation — no extra confirm dialog needed.
	async function withdraw() {
		await withBusy(
			() => cloudApi.withdrawFromTournament(data.tournament.tournament_id),
			"Withdrew from tournament",
		);
	}

	async function transitionChampionship(overrideRanks?: string[]) {
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
			<div class="mx-auto max-w-screen-2xl">
				<TournamentHeader
					{crumbs}
					tournament={data.tournament}
					{statusMeta}
					{hero}
					{playerCount}
					{user}
					combined={data.standings.combined_qualifier_ranking ?? null}
					{isAdmin}
					{canSignUp}
					hasViewerSlot={viewerSlot !== null}
					{busy}
					{startReady}
					{transitionReady}
					settingsDisabled={busy || openMatchId !== null}
					onGuide={openGuide}
					onStart={startTournament}
					onWithdraw={withdraw}
					onConfirmTransition={transitionChampionship}
				/>

				{#if data.tournament.status === "setup"}
					{#if isAdmin}
						<!-- Left column stacks Overview + Signups; Maps sits in the right
						column at its natural height (items-start), so there's blank space
						to the right of Signups until the maps panel grows as maps are added. -->
						<div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
							<div>
								<TournamentOverviewPanel tournament={data.tournament} />
								<TournamentConfigurationPanel
									tournament={data.tournament}
									divACount={slotsA.length}
									divBCount={slotsB.length}
								/>
							</div>
							<TournamentMapsPanel tournament={data.tournament} />
						</div>
					{/if}

					<section
						class="mb-6 rounded-lg p-4"
						style="background-color: rgb(var(--color-surface));"
					>
						<h2 class="mb-3 text-sm font-bold text-tan">Slots</h2>

						{#if isAdmin}
							<div
								class="mb-3 flex flex-wrap items-end gap-2 rounded-lg p-3"
								style="background-color: rgb(var(--color-surface-raised));"
							>
								<label class="block min-w-[14rem] text-xs text-tan">
									Player
									<div class="mt-1">
										<UserAutocomplete
											value={newSlotUsername}
											onValueChange={(v) => (newSlotUsername = v)}
											onSelectUser={(u) => (newSlotUserId = u?.user_id ?? null)}
											disabled={busy}
											inputClass="bg-surface focus:outline-none"
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
								<div class="text-xs text-tan">
									<span class="block">Division</span>
									<RadioGroup
										value={newSlotDivision}
										onChange={(v) => (newSlotDivision = v as Division)}
										ariaLabel="Division"
										class="mt-1 flex gap-3"
									>
										<label class="flex cursor-pointer items-center gap-1">
											<RadioItem value="A" />
											{data.tournament.division_a_name}
										</label>
										<label class="flex cursor-pointer items-center gap-1">
											<RadioItem value="B" />
											{data.tournament.division_b_name}
										</label>
									</RadioGroup>
								</div>
								<button
									type="button"
									class="rounded border border-tan px-3 py-1.5 text-xs text-tan disabled:opacity-50"
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
								<div
									class="rounded-lg p-3"
									style="background-color: rgb(var(--color-surface-raised));"
								>
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
													<th class="py-1 pr-2 text-left">Player</th>
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
															<span class="flex items-start gap-1.5">
																<PlayerAvatar
																	avatarUrl={s.avatar_url}
																	size={15}
																/>
																{#if isAdmin}
																	<SlotUsernameCell
																		slotId={s.slot_id}
																		username={s.display_name}
																		answer={s.signup_answer}
																		editAnswer
																		disabled={busy}
																		onSubstitute={(u, userId, answer) =>
																			substituteSlot(
																				s.slot_id,
																				u,
																				userId,
																				answer,
																			)}
																	/>
																{:else}
																	<span>
																		{s.display_name ??
																			`slot ${s.slot_id.slice(0, 6)}`}
																	</span>
																{/if}
															</span>
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
						style="background-color: rgb(var(--color-surface));"
					>
						<p class="text-sm text-tan opacity-70">
							No standings available yet.
						</p>
					</section>
				{:else}
					{#if data.bracket.rounds.length > 0}
						<!-- Bracket diagram and standings share one card and are
						     toggled (not stacked), matching the Swiss divisions. -->
						<Tabs.Root
							bind:value={championshipView}
							class="mb-8 rounded-lg p-4 pb-2"
							style="background-color: rgb(var(--color-surface));"
						>
							<div
								class="mb-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2"
								style="background-color: rgb(var(--color-surface-raised));"
							>
								<h2 class="text-lg font-bold text-tan">Championship</h2>
								<Tabs.List
									class="relative grid shrink-0 grid-cols-2 overflow-hidden rounded-lg border-2 border-surface"
									style="background-color: rgb(var(--color-surface));"
								>
									<div
										class="pointer-events-none absolute inset-y-0 left-0 w-1/2 transition-transform duration-200 ease-out"
										style:background-color="rgb(var(--color-surface-raised))"
										style:transform={championshipView === "standings"
											? "translateX(100%)"
											: "translateX(0)"}
									></div>
									<Tabs.Trigger value="diagram" class={viewTriggerClass}>
										Bracket
									</Tabs.Trigger>
									<Tabs.Trigger value="standings" class={viewTriggerClass}>
										Standings
									</Tabs.Trigger>
								</Tabs.List>
							</div>
							<div class="view-stack">
								{#key championshipView}
									<div
										class="view-pane"
										in:fade={{ duration: 200 }}
										out:fade={{ duration: 200 }}
									>
										{#if championshipView === "standings"}
											<ChampionshipStandings
												bracket={data.bracket}
												isComplete={data.tournament.status === "complete"}
											/>
										{:else}
											<ChampionshipBracketTree
												bracket={data.bracket}
												tournamentSlug={data.tournament.slug}
												mapPool={data.tournament.map_pool}
												onMatchClick={openMatch}
											>
												{#snippet footer()}
													<PickPreferenceNote />
												{/snippet}
											</ChampionshipBracketTree>
										{/if}
									</div>
								{/key}
							</div>
						</Tabs.Root>
					{/if}

					{#each ["A", "B"] as const as division (division)}
						{@const divisionData = data.standings.divisions[division]}
						{#if divisionData.standings.length > 0}
							<!-- Bracket diagram and standings share one card and are
							     toggled (not stacked) to keep the page compact. -->
							<Tabs.Root
								bind:value={swissView[division]}
								class="mb-8 rounded-lg p-4"
								style="background-color: rgb(var(--color-surface));"
							>
								<div
									class="mb-3 flex items-center justify-between gap-3 rounded-lg px-3 py-2"
									style="background-color: rgb(var(--color-surface-raised));"
								>
									<h2 class="text-lg font-bold text-tan">
										{divisionData.name}
									</h2>
									<Tabs.List
										class="relative grid shrink-0 grid-cols-2 overflow-hidden rounded-lg border-2 border-surface"
										style="background-color: rgb(var(--color-surface));"
									>
										<div
											class="pointer-events-none absolute inset-y-0 left-0 w-1/2 transition-transform duration-200 ease-out"
											style:background-color="rgb(var(--color-surface-raised))"
											style:transform={swissView[division] === "standings"
												? "translateX(100%)"
												: "translateX(0)"}
										></div>
										<Tabs.Trigger value="diagram" class={viewTriggerClass}>
											Rounds
										</Tabs.Trigger>
										<Tabs.Trigger value="standings" class={viewTriggerClass}>
											Standings
										</Tabs.Trigger>
									</Tabs.List>
								</div>
								<div class="view-stack">
									{#key swissView[division]}
										<div
											class="view-pane"
											in:fade={{ duration: 200 }}
											out:fade={{ duration: 200 }}
										>
											{#if swissView[division] === "standings"}
												<SwissStandings
													divisionName=""
													standings={divisionData.standings}
													isViewerAdmin={isAdmin}
													{busy}
													onSubstitute={data.tournament.status ===
													"championship"
														? undefined
														: substituteSlot}
												/>
											{:else}
												<div class="mb-3">
													<PickPreferenceNote />
												</div>
												<SwissFlowBracket
													winsToAdvance={data.tournament.swiss_wins_to_advance}
													lossesToEliminate={data.tournament
														.swiss_losses_to_eliminate}
													maxRounds={data.tournament.swiss_max_rounds}
													standings={divisionData.standings}
													matches={matchesByDivision[division]}
													tournamentSlug={data.tournament.slug}
													mapPool={data.tournament.map_pool}
													onMatchClick={openMatch}
												/>
											{/if}
										</div>
									{/key}
								</div>
							</Tabs.Root>
						{/if}
					{/each}
				{/if}
			</div>
		</div>
	</main>
</div>

<!-- Match detail. Page-level (its data bundle is assembled here and both
     brackets link to it) and anchored to the bracket cell carrying the open
     match's id; open is driven by the `?match=` shallow-routing deep link. -->
<Popover
	open={openMatchId !== null}
	onOpenChange={(o) => {
		if (!o) closeMatch();
	}}
	customAnchor={openMatchId ? `[data-match-id="${openMatchId}"]` : null}
	side={matchSide}
	align="center"
	contentClass={currentMatch?.game_id
		? "w-[min(92vw,35.2rem)]"
		: "w-fit max-w-[92vw]"}
	frameClass="bg-surface p-3 shadow-[0_24px_64px_-12px_rgb(var(--color-black)/0.85)]"
	ariaLabel="Match detail"
>
	{#if currentMatch}
		{#key currentMatch.match_id}
			<MatchPopover
				match={currentMatch}
				tournament={data.tournament}
				{slotLabels}
				{slotUserIds}
				{slotAvatars}
				{user}
				onSubstitute={isAdmin ? substituteSlot : undefined}
				onClose={closeMatch}
			/>
		{/key}
	{/if}
</Popover>

<style>
	/* Crossfade the two views: both panes occupy the same grid cell so the
	   outgoing (out:fade) and incoming (in:fade) overlap in place — no transform,
	   so nothing inside a pane shifts. The cell tracks the taller pane only while
	   both are mounted, then settles to the active one. minmax(0,1fr) keeps the
	   column at the available width so the bracket scrolls internally rather than
	   widening the card. */
	.view-stack {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}

	.view-stack > :global(.view-pane) {
		grid-area: 1 / 1;
		min-width: 0;
	}
</style>
