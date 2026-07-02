<script lang="ts">
	// Match detail body, rendered inside a page-level Popover (see the
	// tournaments/[slug] page). The popover is anchored to the bracket cell the
	// match belongs to via customAnchor, and its open state is driven by the
	// shallow-routing `?match=` deep link — so this component is pure content
	// (no overlay / escape / positioning of its own).
	import { resolve } from "$app/paths";
	import {
		cloudApi,
		type TournamentDetail,
		type TournamentMatch,
		type UserMe,
		type UserSearchResult,
	} from "$lib/api-cloud";
	import type { EChartsOption } from "echarts";
	import type { FullGameData } from "$lib/parser/types";
	import Chart from "$lib/Chart.svelte";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
	import { padMatchNumber } from "$lib/tournament/match-numbers";
	import UserAutocomplete from "$lib/tournament/UserAutocomplete.svelte";
	import SchedulePopover from "$lib/tournament/SchedulePopover.svelte";
	import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
	import {
		CHART_THEME,
		getChartColor,
		getCivilizationColor,
	} from "$lib/config";
	import {
		formatEnum,
		formatRelativeToNow,
		formatScheduledWithLocal,
	} from "$lib/utils/formatting";
	import {
		matchSlotAvatarUrl,
		matchSlotNation,
		matchSlotDisplayName,
	} from "$lib/tournament/match-occupant";
	import { mapScriptLabel } from "$lib/tournament/map-scripts";
	import {
		distinguishingOptions,
		mapPoolLabel,
		poolEntryById,
	} from "$lib/tournament/map-script-options";
	import Select from "$lib/ui/Select.svelte";
	import { runAction } from "$lib/tournament/async-action";
	import FormFooter from "$lib/tournament/FormFooter.svelte";
	import type { SelectOption } from "$lib/ui/types";

	const MAP_ICON = SPRITE_MANIFEST["icons/MAP_OVERVIEW"];

	interface Props {
		match: TournamentMatch;
		tournament: TournamentDetail;
		slotLabels: Record<string, string>;
		slotUserIds: Record<string, string | null>;
		slotAvatars: Record<string, string | null>;
		user: UserMe | null;
		// Global "Match N" (server-assigned match_number), supplied by parents
		// that have the full match list. Omitted for byes / placeholder matches
		// and views without the list.
		matchNumber?: number;
		// Admin substitute: rename the named slot's occupant, optionally pre-
		// linking to a registered user (userId from the autocomplete; null for
		// free text). Wired by the parent to the same handler that drives the
		// swiss-standings edit pencil; undefined for non-admin viewers.
		onSubstitute?: (
			// eslint-disable-next-line no-unused-vars -- param names are documentary
			slotId: string,
			// eslint-disable-next-line no-unused-vars -- param names are documentary
			newUsername: string,
			// eslint-disable-next-line no-unused-vars -- param names are documentary
			userId: string | null,
		) => void;
		onClose: () => void;
	}

	let {
		match,
		tournament,
		slotLabels,
		slotUserIds,
		slotAvatars,
		user,
		matchNumber,
		onSubstitute,
		onClose,
	}: Props = $props();

	type EditMode = "none" | "map" | "retro";
	let editMode = $state<EditMode>("none");
	let busy = $state(false);

	// Inline substitute editor (admin-only). When a side is set, the matching
	// slot's name in the header is replaced by an input + ✓ / × buttons.
	// Defined here so the binding exists in the script's lexical scope; the
	// derived gate / save handler live below the labels they read.
	let substituteSide = $state<"a" | "b" | null>(null);
	let substituteValue = $state("");
	// Set when the admin picks a user from the autocomplete; null for a free-
	// text substitution. Cleared on open/cancel and when the value diverges
	// from the picked handle.
	let substitutePickedUserId = $state<string | null>(null);
	let substituteError = $state<string | null>(null);

	// Edit-form state lives at module scope so it survives data refreshes
	// (e.g. an invalidateAll from a sibling save) without clobbering whatever
	// the admin is currently typing. The parent is expected to wrap the popover
	// in {#key match.match_id} so navigating to a different match remounts
	// and resets these naturally.
	// svelte-ignore state_referenced_locally
	let mapPoolIdInput = $state(match.map_pool_id ?? "");
	// svelte-ignore state_referenced_locally
	let retroWinnerSlotId = $state<string | null>(match.winner_slot_id);
	// svelte-ignore state_referenced_locally
	let retroStatus = $state<"complete" | "forfeit" | "pending">(
		match.status === "complete" || match.status === "forfeit"
			? match.status
			: "complete",
	);

	const isAdmin = $derived(tournament.is_viewer_admin === true);
	// Synthesized client-side placeholder for a future championship cell that
	// the backend hasn't generated yet. Triggers preview-mode rendering:
	// "TBD" for unresolved feeder sides, no map / no upload / no retro
	// actions, substitute pencil only on resolved sides.
	const isPlaceholder = $derived(match.is_placeholder === true);
	// `slot_a_id` is non-empty string for real matches; the placeholder
	// synthesizer falls back to "" when the feeder hasn't decided.
	const isSlotAResolved = $derived(match.slot_a_id !== "");
	// Labels and avatars prefer the per-match snapshot for non-pending matches
	// (so a later substitution doesn't rewrite historical names/avatars), and
	// fall through to the live slotLabels/slotAvatars maps for pending matches.
	const slotALabel = $derived(
		isPlaceholder && !isSlotAResolved
			? "TBD"
			: (matchSlotDisplayName(match, "a", slotLabels) ?? "—"),
	);
	const slotBLabel = $derived(
		match.slot_b_id !== null
			? (matchSlotDisplayName(match, "b", slotLabels) ?? "—")
			: isPlaceholder
				? "TBD"
				: "Bye",
	);
	// The substitute editor seeds/compares against the LIVE slot's raw handle
	// (admin-only field), never the display label — so opening it on a claimed
	// slot can't rewrite the handle to the display name and unlink the slot.
	// Falls back to the label when the handle is absent (non-admins can't
	// substitute anyway; unclaimed slots have handle == typed name == label).
	const slotAHandle = $derived(match.slot_a_discord_username ?? slotALabel);
	const slotBHandle = $derived(match.slot_b_discord_username ?? slotBLabel);

	const winnerSide = $derived<"a" | "b" | null>(
		match.winner_slot_id === null
			? null
			: match.winner_slot_id === match.slot_a_id
				? "a"
				: "b",
	);
	const loserSide = $derived<"a" | "b" | null>(
		winnerSide === null ? null : winnerSide === "a" ? "b" : "a",
	);
	const winnerLabel = $derived(
		winnerSide === null
			? null
			: (matchSlotDisplayName(match, winnerSide, slotLabels) ?? null),
	);
	// The slot that didn't win — used for the dimmed half of the title.
	const loserLabel = $derived.by(() => {
		if (loserSide === null) return null;
		const loserId = loserSide === "a" ? match.slot_a_id : match.slot_b_id;
		if (loserId === null) return "Bye";
		return matchSlotDisplayName(match, loserSide, slotLabels) ?? "—";
	});

	const slotAAvatar = $derived(matchSlotAvatarUrl(match, "a", slotAvatars));
	const slotBAvatar = $derived(
		match.slot_b_id !== null
			? matchSlotAvatarUrl(match, "b", slotAvatars)
			: null,
	);
	const winnerAvatar = $derived.by(() => {
		if (match.winner_slot_id === null) return null;
		const side = match.winner_slot_id === match.slot_a_id ? "a" : "b";
		return matchSlotAvatarUrl(match, side, slotAvatars);
	});
	const loserAvatar = $derived.by(() => {
		if (match.winner_slot_id === null) return null;
		const loserSide: "a" | "b" =
			match.winner_slot_id === match.slot_a_id ? "b" : "a";
		const loserId = loserSide === "a" ? match.slot_a_id : match.slot_b_id;
		if (loserId === null) return null;
		return matchSlotAvatarUrl(match, loserSide, slotAvatars);
	});

	// The map_pool instance this match was assigned, resolved from its id.
	const matchEntry = $derived(
		poolEntryById(tournament.map_pool, match.map_pool_id),
	);
	// Options that vary across the pool — drives the variant shown in map labels.
	const distinguishing = $derived(distinguishingOptions(tournament.map_pool));
	// Full map label ("Square Duel Coastal Rain Basin PS"), falling back to the
	// bare script label if the instance is no longer in the pool.
	const mapName = $derived(
		match.map_script
			? matchEntry
				? mapPoolLabel(matchEntry, distinguishing, false)
				: mapScriptLabel(match.map_script)
			: null,
	);

	const isParticipant = $derived(
		user !== null &&
			(slotUserIds[match.slot_a_id] === user.user_id ||
				(match.slot_b_id !== null &&
					slotUserIds[match.slot_b_id] === user.user_id)),
	);
	// Placeholder cells don't correspond to a real tournament_matches row
	// yet, so any action that PATCHes the match (map, retro, upload-link) is
	// suppressed in preview mode.
	// Participant uploads their own match. Non-admins only while pending
	// (first-upload-wins, no replace). Admin participants any time — that's
	// how an admin fixes a wrong save on their own already-reported match,
	// using the participant "which nation were you?" picker.
	const canUploadAsParticipant = $derived(
		!isPlaceholder &&
			isParticipant &&
			match.status !== "bye" &&
			(match.status === "pending" || isAdmin),
	);
	// Observer (admin acting on someone else's match) — only when NOT a
	// participant, so an admin-participant never lands in the dual-slot
	// observer picker for their own game.
	const canUploadAsObserver = $derived(
		!isPlaceholder && isAdmin && !isParticipant && match.status !== "bye",
	);
	const canEditMap = $derived(
		!isPlaceholder && isAdmin && match.status === "pending",
	);
	const canRetroEdit = $derived(
		!isPlaceholder && isAdmin && match.status !== "bye",
	);
	const retroEditLabel = $derived(
		match.status === "pending" ? "Set result" : "Edit result",
	);
	// Scheduling/streams (time / casters / stream links) is open to admins and
	// participants on any real, non-bye match: pending to coordinate the upcoming
	// game, complete/forfeit to attach stream links and casters after it's played.
	// Suppressed on placeholder cells (no real match row yet).
	const canSchedule = $derived(
		!isPlaceholder && match.status !== "bye" && (isAdmin || isParticipant),
	);
	// Read view splits the old combined parts block into two stacked panels: the
	// schedule (per-part times) and casting (per-part casters + stream links).
	// castingParts keeps each part's original 1-based number so a split match
	// labels "Part N" consistently in both panels, and drops parts with no
	// broadcast info so the casting panel only lists sittings that have some.
	const castingParts = $derived(
		match.parts
			.map((part, i) => ({ part, partNumber: i + 1 }))
			.filter(({ part }) => part.casters.length > 0 || part.streams.length > 0),
	);
	const hasSecondaryActions = $derived(
		canSchedule ||
			canUploadAsParticipant ||
			canUploadAsObserver ||
			canEditMap ||
			canRetroEdit,
	);

	// Substitution availability. Only shown on still-pending matches: the
	// pencil reads as "this is the next game — swap who's playing it" rather
	// than the more confusing "edit the participant on a finished match"
	// (substitution affects the slot's future matches, never the completed
	// one whose snapshot is frozen). Roster edits on past matches are still
	// reachable through the swiss-standings pencil during swiss phase, and
	// through any future pending match during championship. The per-side
	// gate (in the snippet) additionally requires a resolved slot — a TBD
	// side has no occupant to substitute.
	const canSubstitute = $derived(
		isAdmin &&
			onSubstitute !== undefined &&
			tournament.status !== "complete" &&
			match.status === "pending",
	);

	function openSubstitute(side: "a" | "b") {
		substituteSide = side;
		// Seed with the real handle, not the display label (see slotAHandle).
		substituteValue = side === "a" ? slotAHandle : slotBHandle;
		substitutePickedUserId = null;
		substituteError = null;
	}

	function cancelSubstitute() {
		substituteSide = null;
		substitutePickedUserId = null;
		substituteError = null;
	}

	function saveSubstitute() {
		if (substituteSide === null || !onSubstitute) return;
		const trimmed = substituteValue.trim();
		if (!trimmed) {
			substituteError = "Username cannot be empty";
			return;
		}
		const slotId = substituteSide === "a" ? match.slot_a_id : match.slot_b_id;
		if (slotId === null) {
			substituteError = "Bye slot — nothing to substitute";
			return;
		}
		const currentHandle = substituteSide === "a" ? slotAHandle : slotBHandle;
		// No-op when the handle is unchanged and no user was picked to link.
		if (trimmed === currentHandle && substitutePickedUserId === null) {
			cancelSubstitute();
			return;
		}
		onSubstitute(slotId, trimmed, substitutePickedUserId);
		cancelSubstitute();
	}

	function onSubstituteSelectUser(user: UserSearchResult | null) {
		substitutePickedUserId = user?.user_id ?? null;
	}

	// Status chip styling: completed/bye reads as a "done" amber pill, anything
	// else (pending) as a muted neutral pill.
	const statusChipClass = $derived(
		match.status === "complete" || match.status === "bye"
			? "border-amber-300 bg-amber-700/40 text-amber-300"
			: "border-input text-tan opacity-70",
	);

	// Lazily load the match's game blob (all tournament games are public) so the
	// card can show victory type, turns, and the legitimacy sparkline. Winner is
	// taken from the match record, NOT the save: an admin can retro-edit the
	// result to something the save itself wouldn't agree with.
	let gameData = $state<FullGameData | null>(null);
	let gameLoading = $state(false);
	$effect(() => {
		const gid = match.game_id;
		gameData = null;
		if (!gid) return;
		gameLoading = true;
		let cancelled = false;
		cloudApi
			.getPublicGame(gid)
			.then((g) => {
				if (!cancelled) gameData = g;
			})
			.catch(() => {
				if (!cancelled) gameData = null;
			})
			.finally(() => {
				if (!cancelled) gameLoading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	const victoryType = $derived(
		gameData?.game_details.winner_victory_type
			? formatEnum(gameData.game_details.winner_victory_type, "VICTORY_")
			: null,
	);
	const totalTurns = $derived(gameData?.game_details.total_turns ?? null);

	function playerColor(nation: string | null, idx: number): string {
		if (nation) {
			const c = getCivilizationColor(nation);
			if (c) return c;
		}
		return getChartColor(idx);
	}

	const hasSparkline = $derived(
		(gameData?.player_history ?? []).some((p) => p.history.length > 0),
	);

	// Per-turn victory-points series per player — mirrors the home-page
	// RecentSaveCard sparkline. Sourced directly from the blob's
	// player_history (which carries `points`), so no reindex is needed here.
	const sparklineOption = $derived<EChartsOption>({
		animation: false,
		backgroundColor: "transparent",
		grid: { left: 4, right: 4, top: 4, bottom: 4 },
		xAxis: {
			type: "value",
			show: false,
			min: 0,
			max: totalTurns && totalTurns > 0 ? totalTurns : undefined,
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
		series: (gameData?.player_history ?? []).map((p, i) => ({
			name: `${p.player_name}${p.nation ? ` (${formatEnum(p.nation, "NATION_")})` : ""}`,
			type: "line",
			showSymbol: false,
			smooth: true,
			sampling: "lttb",
			lineStyle: { width: 1.5, color: playerColor(p.nation, i) },
			data: p.history.map((pt) => [pt.turn, pt.points ?? 0]),
		})),
	});

	// Map-instance dropdown: one option per map_pool entry, labelled with the
	// canonical full map label so it matches the rest of the UI.
	const mapSelectOptions = $derived<SelectOption[]>(
		tournament.map_pool.map((e) => ({
			value: e.id,
			label: mapPoolLabel(e, distinguishing, false),
		})),
	);
	const winnerOptions = $derived<SelectOption[]>([
		{ value: match.slot_a_id, label: slotALabel },
		...(match.slot_b_id ? [{ value: match.slot_b_id, label: slotBLabel }] : []),
	]);
	const RETRO_STATUS_OPTIONS: SelectOption[] = [
		{ value: "complete", label: "complete" },
		{ value: "forfeit", label: "forfeit" },
		{ value: "pending", label: "pending" },
	];

	function openMapEdit() {
		mapPoolIdInput = match.map_pool_id ?? "";
		editMode = "map";
	}

	async function saveMapEdit() {
		const ok = await runAction(
			() =>
				cloudApi.patchMatchMap(tournament.tournament_id, match.match_id, {
					map_pool_id: mapPoolIdInput || undefined,
				}),
			{ setBusy: (b) => (busy = b), success: "Map updated" },
		);
		if (ok !== null) editMode = "none";
	}

	function openRetroEdit() {
		retroWinnerSlotId = match.winner_slot_id;
		retroStatus =
			match.status === "pending"
				? "complete"
				: (match.status as "complete" | "forfeit");
		editMode = "retro";
	}

	async function saveRetroEdit() {
		const ok = await runAction(
			() =>
				cloudApi.retroEditMatch(tournament.tournament_id, match.match_id, {
					winner_slot_id: retroWinnerSlotId,
					status: retroStatus,
				}),
			{ setBusy: (b) => (busy = b), success: "Match edited" },
		);
		if (ok !== null) editMode = "none";
	}
</script>

<!-- Inline name + admin substitute-edit affordance. Renders either:
       (a) name + small "edit" link (admin, slot present, not currently editing);
       (b) inline input + ✓ / × (admin, currently editing this side); or
       (c) just the name (non-admin, or this side is the bye slot).
     `side` names the underlying slot (slot_a / slot_b), independent of which
     half of the visual layout it occupies (winner vs loser may swap them). -->
{#snippet nameWithEdit(
	side: "a" | "b",
	label: string,
	avatar: string | null,
	isWinner: boolean,
)}
	{@const slotId = side === "a" ? match.slot_a_id : match.slot_b_id}
	{@const nation = matchSlotNation(match, side)}
	{#if substituteSide === side}
		<span class="inline-flex flex-col gap-0.5">
			<span class="inline-flex items-center gap-1">
				<UserAutocomplete
					value={substituteValue}
					onValueChange={(next) => {
						substituteValue = next;
						substituteError = null;
					}}
					onSelectUser={onSubstituteSelectUser}
					onEnter={saveSubstitute}
					disabled={busy}
					autofocusOnMount
				/>
				<button
					type="button"
					class="text-xs text-tan opacity-70 hover:text-orange hover:opacity-100"
					onclick={saveSubstitute}
					disabled={busy}
					aria-label="Save substitution"
				>
					✓
				</button>
				<button
					type="button"
					class="text-xs text-tan opacity-50 hover:opacity-100"
					onclick={cancelSubstitute}
					disabled={busy}
					aria-label="Cancel"
				>
					×
				</button>
			</span>
			{#if substituteError}
				<span class="text-[10px] text-red-400">{substituteError}</span>
			{/if}
		</span>
	{:else}
		<span
			class="inline-flex min-w-0 items-center gap-1.5"
			class:text-orange={isWinner}
		>
			{#if nation}
				<SpriteIcon
					category="crests"
					value={nation}
					size={16}
					alt={formatEnum(nation, "NATION_")}
				/>
			{/if}
			<PlayerAvatar avatarUrl={avatar} size={14} />
			<span class="truncate">{label}</span>
			{#if canSubstitute && slotId !== null && slotId !== ""}
				<button
					type="button"
					class="shrink-0 text-tan opacity-40 transition-colors hover:text-orange hover:opacity-100"
					onclick={() => openSubstitute(side)}
					disabled={busy}
					aria-label="Substitute player"
					title="Substitute player"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-3.5 w-3.5"
						viewBox="0 0 20 20"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.886L17.5 5.501a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z"
						/>
					</svg>
				</button>
			{/if}
		</span>
	{/if}
{/snippet}

<!-- Header styled like the bracket section bar (e.g. the "West" / "Championship"
     headers): a surface-raised rounded bar carrying the matchup, the status badge to
     its right, the controls far-right, and bracket · round on a second line. -->
<header
	class="mb-3 rounded-lg px-3 py-2"
	style="background-color: rgb(var(--color-surface-raised));"
>
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0 flex-1">
			<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
				<h2
					class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-lg font-bold text-tan"
				>
					{#if winnerLabel && winnerSide !== null && loserSide !== null}
						{@render nameWithEdit(winnerSide, winnerLabel, winnerAvatar, true)}
						<span class="mx-1 opacity-50">v</span>
						{#if loserLabel === "Bye"}
							<span class="inline-flex min-w-0 items-center gap-1.5 opacity-50">
								<span class="truncate">Bye</span>
							</span>
						{:else if loserLabel !== null}
							{@render nameWithEdit(loserSide, loserLabel, loserAvatar, false)}
						{/if}
					{:else}
						{@render nameWithEdit("a", slotALabel, slotAAvatar, false)}
						<span class="mx-1 opacity-50">v</span>
						{#if match.slot_b_id !== null}
							{@render nameWithEdit("b", slotBLabel, slotBAvatar, false)}
						{:else}
							<span class="inline-flex min-w-0 items-center gap-1.5">
								<span class="truncate">{slotBLabel}</span>
							</span>
						{/if}
					{/if}
				</h2>
				<span
					class="shrink-0 rounded-full border px-2 py-0.5 text-[11px] {statusChipClass}"
				>
					{isPlaceholder ? "awaiting prior round" : match.status}
				</span>
			</div>
			<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
				<span class="text-tan opacity-70">
					{#if match.phase === "championship"}
						Championship
					{:else if match.division}
						{match.division === "A"
							? tournament.division_a_name
							: tournament.division_b_name}
					{/if}
					{#if match.round_number}
						· Round {match.round_number}
					{/if}
				</span>
			</div>
		</div>
		<div class="flex flex-shrink-0 items-start gap-2">
			<button
				type="button"
				class="text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100"
				onclick={onClose}
				aria-label="Close"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M6 18L18 6M6 6l12 12"
					/>
				</svg>
			</button>
		</div>
	</div>
</header>

<div class="flex flex-col gap-3">
	{#if isPlaceholder}
		<div
			class="rounded-lg p-3 text-xs text-tan opacity-70"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			This match is generated once the prior round finishes. Map, result, and
			uploads aren't available yet — once both feeders report, the real match
			takes over this cell.
		</div>
	{:else if match.game_id}
		<!-- Result card: save-derived stats in three plain columns. -->
		<div
			class="rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			{#if gameLoading && !gameData}
				<p class="text-xs text-tan opacity-60">Loading game…</p>
			{:else if gameData}
				<div class="grid grid-cols-3 gap-3 text-center">
					<div>
						<p
							class="mb-0.5 flex items-center justify-center gap-1 text-[10px] font-bold text-gray-400"
						>
							<SpriteIcon
								category="icons"
								value="ACHIEVEMENT_WIN"
								size={10}
								alt="Winner"
							/>
							Winner
						</p>
						<p
							class="flex items-center justify-center gap-1.5 text-sm font-bold text-bright"
						>
							{#if winnerLabel}
								<PlayerAvatar avatarUrl={winnerAvatar} size={14} />
							{/if}
							<span class="truncate">{winnerLabel ?? "—"}</span>
						</p>
					</div>
					<div>
						<p
							class="mb-0.5 flex items-center justify-center gap-1 text-[10px] font-bold text-gray-400"
						>
							<SpriteIcon
								category="icons"
								value="VICTORY_NORMAL"
								size={10}
								alt="Victory Type"
							/>
							Victory Type
						</p>
						<p class="truncate text-sm font-bold text-bright">
							{victoryType ?? "—"}
						</p>
					</div>
					<div>
						<p
							class="mb-0.5 flex items-center justify-center gap-1 text-[10px] font-bold text-gray-400"
						>
							<SpriteIcon category="icons" value="TURN" size={10} alt="Turns" />
							Turns
						</p>
						<p class="truncate text-sm font-bold text-bright">
							{totalTurns ?? "—"}
						</p>
					</div>
				</div>
			{/if}
		</div>
		{#if hasSparkline}
			<div
				class="rounded-lg p-3"
				style="background-color: rgb(var(--color-surface-raised));"
			>
				<Chart option={sparklineOption} height="60px" />
			</div>
		{/if}
	{:else if winnerLabel}
		<!-- Decided without a save (forfeit / admin-set result): show only the
		     winner — no save card with empty "—" stats. -->
		<div
			class="rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<p
				class="mb-0.5 flex items-center gap-1 text-[10px] font-bold text-gray-400"
			>
				<SpriteIcon
					category="icons"
					value="ACHIEVEMENT_WIN"
					size={10}
					alt="Winner"
				/>
				Winner
			</p>
			<p class="flex items-center gap-1.5 text-sm font-bold text-bright">
				<PlayerAvatar avatarUrl={winnerAvatar} size={14} />
				<span class="truncate">{winnerLabel}</span>
			</p>
		</div>
	{/if}

	{#if mapName || canEditMap}
		<div
			class="rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<div class="flex items-center gap-1.5 text-sm text-tan">
				<img src={MAP_ICON} alt="" class="h-4 w-4 shrink-0 opacity-80" />
				<span class="truncate" title={mapName ?? undefined}>
					{#if mapName}{mapName}{:else}<span class="opacity-60"
							>(no map set)</span
						>{/if}
				</span>
				{#if canEditMap}
					<button
						type="button"
						class="ml-auto shrink-0 text-tan opacity-70 transition-colors hover:text-orange hover:opacity-100 disabled:opacity-50"
						onclick={openMapEdit}
						disabled={busy}
						aria-label="Change map"
						title="Change map"
					>
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
								d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
							/>
						</svg>
					</button>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Schedule: per-sitting time(s). "Part N" appears only for a split match;
	     a single-session match reads as one unlabeled row. Casters and stream
	     links live in the Casting panel below. Editing both happens behind the
	     Schedule button. -->
	{#if !isPlaceholder && match.parts.length > 0}
		<div
			class="flex flex-col gap-2 rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			{#each match.parts as part, i (part.id)}
				<div
					class="flex items-center gap-2 {i > 0
						? 'border-t border-border-subtle pt-2'
						: ''}"
				>
					{#if match.parts.length > 1}
						<span
							class="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted"
							>Part {i + 1}</span
						>
					{/if}
					{#if part.scheduled_at}
						<div class="flex items-center gap-1.5 text-xs text-tan">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-4 w-4 shrink-0 opacity-80"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="2"
								aria-hidden="true"
							>
								<rect x="3" y="4" width="18" height="18" rx="2" />
								<path d="M16 2v4M8 2v4M3 10h18" />
							</svg>
							<span
								>{formatScheduledWithLocal(part.scheduled_at)}<span
									class="text-muted"
								>
									· {formatRelativeToNow(part.scheduled_at)}</span
								></span
							>
						</div>
					{:else}
						<span class="text-xs text-muted">Not yet scheduled</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<!-- Casting: per-sitting casters and their stream links (the broadcast), split
	     out from the schedule above. Only sittings that have a caster or stream
	     appear; "Part N" labels them when the match is split. -->
	{#if !isPlaceholder && castingParts.length > 0}
		<div
			class="flex flex-col gap-2 rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			{#each castingParts as { part, partNumber }, i (part.id)}
				<div
					class="flex flex-col gap-1.5 {i > 0
						? 'border-t border-border-subtle pt-2'
						: ''}"
				>
					{#if match.parts.length > 1}
						<span
							class="text-[10px] font-bold uppercase tracking-wider text-muted"
							>Part {partNumber}</span
						>
					{/if}
					<!-- Caster on the left, its stream link(s) to the right. -->
					<div class="flex items-start gap-3">
						{#if part.casters.length > 0}
							<!-- Streamer first (with avatar), co-casters appended. -->
							<div
								class="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-tan"
							>
								<PlayerAvatar
									avatarUrl={part.casters[0].avatar_url}
									size={14}
								/>
								<span class="truncate">
									Cast by {part.casters[0]
										.display_name}{#if part.casters.length > 1}
										<span class="text-muted"
											>&nbsp;with {part.casters
												.slice(1)
												.map((c) => c.display_name)
												.join(", ")}</span
										>{/if}
								</span>
							</div>
						{/if}
						{#if part.streams.length > 0}
							<!-- Stream links (youtube/twitch), validated host-side; external
							     URLs, so resolve() doesn't apply. ml-auto pins them right even
							     when a sitting has a stream but no named caster. Keyed by index:
							     the same URL may legitimately appear twice (two labels), and
							     order is the identity — the list is replaced wholesale on save. -->
							<!-- eslint-disable svelte/no-navigation-without-resolve -->
							<div class="ml-auto flex shrink-0 flex-col items-end gap-1">
								{#each part.streams as stream, vi (vi)}
									<a
										href={stream.url}
										target="_blank"
										rel="noopener noreferrer"
										class="inline-flex items-center gap-1.5 text-xs text-tan hover:underline"
									>
										<span class="truncate"
											>{stream.label?.trim() || "Stream"}</span
										>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											class="h-4 w-4 shrink-0"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											stroke-width="2"
											aria-hidden="true"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
											/>
										</svg>
									</a>
								{/each}
							</div>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if editMode === "map"}
		<div
			class="flex flex-col gap-2 rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<h3 class="text-xs font-bold text-tan">Change map</h3>
			<label class="text-xs text-tan">
				Map
				<Select
					value={mapPoolIdInput}
					onChange={(v) => (mapPoolIdInput = v ?? "")}
					options={mapSelectOptions}
					placeholder="(no map set)"
					ariaLabel="Map"
					class="mt-1 w-full"
				/>
			</label>
			<FormFooter
				onCancel={() => (editMode = "none")}
				onConfirm={saveMapEdit}
				confirmLabel="Save"
				{busy}
			/>
		</div>
	{:else if editMode === "retro"}
		<div
			class="flex flex-col gap-2 rounded-lg p-3"
			style="background-color: rgb(var(--color-surface-raised));"
		>
			<h3 class="text-xs font-bold text-tan">{retroEditLabel}</h3>
			<label class="text-xs text-tan">
				Winner
				<Select
					value={retroWinnerSlotId ?? ""}
					onChange={(v) => (retroWinnerSlotId = v)}
					options={winnerOptions}
					placeholder="Select winner"
					disabled={retroStatus === "pending"}
					ariaLabel="Winner"
					class="mt-1 w-full"
				/>
			</label>
			<label class="text-xs text-tan">
				Status
				<Select
					value={retroStatus}
					onChange={(v) => {
						const s = (v ?? "complete") as typeof retroStatus;
						retroStatus = s;
						if (s === "pending") retroWinnerSlotId = null;
					}}
					options={RETRO_STATUS_OPTIONS}
					ariaLabel="Status"
					class="mt-1 w-full"
				/>
			</label>
			<FormFooter
				onCancel={() => (editMode = "none")}
				onConfirm={saveRetroEdit}
				confirmLabel="Save"
				{busy}
			/>
		</div>
	{/if}

	<!-- Footer actions: match controls on the left, "View full game" on the
	     right, all sharing the same bordered-tan button style. -->
	{#if hasSecondaryActions || match.game_id}
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div class="flex flex-wrap items-center gap-2">
				{#if canSchedule}
					<SchedulePopover {match} {tournament} />
				{/if}
				{#if canUploadAsParticipant}
					<a
						class="inline-flex items-center gap-1.5 rounded border border-input px-2.5 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
						href="{resolve(
							'/upload',
						)}?tournament_match_id={match.match_id}&return_slug={tournament.slug}"
					>
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
								d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0-12l-4 4m4-4l4 4"
							/>
						</svg>
						{match.game_id ? "Replace save" : "Upload save"}
					</a>
				{/if}
				{#if canUploadAsObserver}
					<a
						class="inline-flex items-center gap-1.5 rounded border border-input px-2.5 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
						href="{resolve(
							'/upload',
						)}?tournament_match_id={match.match_id}&return_slug={tournament.slug}&observer=1"
					>
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
								d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0-12l-4 4m4-4l4 4"
							/>
						</svg>
						{match.game_id ? "Replace save" : "Upload save (observer)"}
					</a>
				{/if}
				{#if canRetroEdit}
					<button
						type="button"
						class="inline-flex items-center gap-1.5 rounded border border-input px-2.5 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
						onclick={openRetroEdit}
						disabled={busy}
					>
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
								d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
							/>
						</svg>
						{retroEditLabel}
					</button>
				{/if}
			</div>
			{#if match.game_id}
				<a
					class="inline-flex items-center gap-1.5 rounded border border-input px-2.5 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
					href={resolve("/games/[id]", { id: match.game_id })}
				>
					View full game
				</a>
			{/if}
		</div>
	{/if}
</div>
