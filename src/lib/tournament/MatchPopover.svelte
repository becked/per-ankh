<script lang="ts">
	// Match detail body, rendered inside a page-level Popover (see the
	// tournaments/[slug] page). The popover is anchored to the bracket cell the
	// match belongs to via customAnchor, and its open state is driven by the
	// shallow-routing `?match=` deep link — so this component is pure content
	// (no overlay / escape / positioning of its own).
	import { resolve } from "$app/paths";
	import { autofocus } from "$lib/actions/autofocus";
	import {
		ApiError,
		cloudApi,
		type TournamentDetail,
		type TournamentMatch,
		type UserMe,
	} from "$lib/api-cloud";
	import { invalidateAll } from "$app/navigation";
	import type { EChartsOption } from "echarts";
	import type { FullGameData } from "$lib/parser/types";
	import Chart from "$lib/Chart.svelte";
	import SpriteIcon from "$lib/game-detail/SpriteIcon.svelte";
	import PlayerAvatar from "$lib/tournament/PlayerAvatar.svelte";
	import { SPRITE_MANIFEST } from "$lib/generated/sprite-manifest";
	import {
		CHART_THEME,
		getChartColor,
		getCivilizationColor,
	} from "$lib/config";
	import { formatEnum } from "$lib/utils/formatting";
	import {
		matchSlotAvatarUrl,
		matchSlotUsername,
	} from "$lib/tournament/match-occupant";
	import { mapScriptLabel } from "$lib/tournament/map-scripts";
	import {
		effectiveOptionValue,
		mapFullName,
		mapOptionChoiceLabel,
		poolEntryById,
	} from "$lib/tournament/map-script-options";
	import Select from "$lib/ui/Select.svelte";
	import { toast } from "$lib/ui/toast";
	import type { SelectOption } from "$lib/ui/types";

	const MAP_ICON = SPRITE_MANIFEST["icons/MAP_OVERVIEW"];

	interface Props {
		match: TournamentMatch;
		tournament: TournamentDetail;
		slotLabels: Record<string, string>;
		slotUserIds: Record<string, string | null>;
		slotAvatars: Record<string, string | null>;
		user: UserMe | null;
		// Admin substitute: rename the named slot's occupant. Wired by the
		// parent to the same handler that drives the swiss-standings edit
		// pencil; undefined for non-admin viewers.
		// eslint-disable-next-line no-unused-vars -- param names are documentary
		onSubstitute?: (slotId: string, newUsername: string) => void;
		onClose: () => void;
	}

	let {
		match,
		tournament,
		slotLabels,
		slotUserIds,
		slotAvatars,
		user,
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
			: (matchSlotUsername(match, "a", slotLabels) ?? "—"),
	);
	const slotBLabel = $derived(
		match.slot_b_id !== null
			? (matchSlotUsername(match, "b", slotLabels) ?? "—")
			: isPlaceholder
				? "TBD"
				: "Bye",
	);
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
			: (matchSlotUsername(match, winnerSide, slotLabels) ?? null),
	);
	// The slot that didn't win — used for the dimmed half of the title.
	const loserLabel = $derived.by(() => {
		if (loserSide === null) return null;
		const loserId = loserSide === "a" ? match.slot_a_id : match.slot_b_id;
		if (loserId === null) return "Bye";
		return matchSlotUsername(match, loserSide, slotLabels) ?? "—";
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
	// Full map name in our format ("Duel Continent Mirror …"), falling back to
	// the bare script label if the instance is no longer in the pool.
	const mapName = $derived(
		match.map_script
			? matchEntry
				? mapFullName(matchEntry.options, matchEntry.script)
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
		!isPlaceholder && isParticipant && (match.status === "pending" || isAdmin),
	);
	// Observer (admin acting on someone else's match) — only when NOT a
	// participant, so an admin-participant never lands in the dual-slot
	// observer picker for their own game.
	const canUploadAsObserver = $derived(
		!isPlaceholder && isAdmin && !isParticipant,
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
	const hasSecondaryActions = $derived(
		canUploadAsParticipant || canUploadAsObserver || canEditMap || canRetroEdit,
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

	function openSubstitute(side: "a" | "b", currentLabel: string) {
		substituteSide = side;
		substituteValue = currentLabel;
		substituteError = null;
	}

	function cancelSubstitute() {
		substituteSide = null;
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
		const currentLabel = substituteSide === "a" ? slotALabel : slotBLabel;
		if (trimmed === currentLabel) {
			cancelSubstitute();
			return;
		}
		onSubstitute(slotId, trimmed);
		cancelSubstitute();
	}

	function onSubstituteKey(e: KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault();
			saveSubstitute();
		} else if (e.key === "Escape") {
			e.preventDefault();
			cancelSubstitute();
		}
	}

	// Status chip styling: completed/bye reads as a "done" amber pill, anything
	// else (pending) as a muted neutral pill.
	const statusChipClass = $derived(
		match.status === "complete" || match.status === "bye"
			? "border-amber-300 bg-amber-700/40 text-amber-300"
			: "border-[#4a433b] text-tan opacity-70",
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
			const c = getCivilizationColor(nation.replace(/^NATION_/, ""));
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

	// Short label that disambiguates instances of the same script by their
	// aspect + size (e.g. "Continent · Wide Duel").
	function instanceLabel(e: {
		script: string;
		options: Record<string, string | boolean>;
	}): string {
		const aspect = mapOptionChoiceLabel(
			"MAPASPECTRATIO",
			effectiveOptionValue(e.options, "MAPASPECTRATIO"),
		);
		const size = mapOptionChoiceLabel(
			"MAPSIZE",
			effectiveOptionValue(e.options, "MAPSIZE"),
		);
		return `${mapScriptLabel(e.script)} · ${aspect} ${size}`;
	}

	// Map-instance dropdown: one option per map_pool entry.
	const mapSelectOptions = $derived<SelectOption[]>(
		tournament.map_pool.map((e) => ({
			value: e.id,
			label: instanceLabel(e),
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

	async function withBusy<T>(
		op: () => Promise<T>,
		successMessage: string,
	): Promise<T | null> {
		busy = true;
		try {
			const out = await op();
			toast.info(successMessage);
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

	function openMapEdit() {
		mapPoolIdInput = match.map_pool_id ?? "";
		editMode = "map";
	}

	async function saveMapEdit() {
		const ok = await withBusy(
			() =>
				cloudApi.patchMatchMap(tournament.tournament_id, match.match_id, {
					map_pool_id: mapPoolIdInput || undefined,
				}),
			"Map updated",
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
		const ok = await withBusy(
			() =>
				cloudApi.retroEditMatch(tournament.tournament_id, match.match_id, {
					winner_slot_id: retroWinnerSlotId,
					status: retroStatus,
				}),
			"Match edited",
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
	faded: boolean,
)}
	{@const slotId = side === "a" ? match.slot_a_id : match.slot_b_id}
	{#if substituteSide === side}
		<span class="inline-flex flex-col gap-0.5">
			<span class="inline-flex items-center gap-1">
				<input
					type="text"
					bind:value={substituteValue}
					oninput={() => (substituteError = null)}
					onkeydown={onSubstituteKey}
					use:autofocus
					class="rounded border border-black bg-[#35302b] p-1 text-sm text-tan"
					disabled={busy}
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
			class:opacity-50={faded}
		>
			<PlayerAvatar avatarUrl={avatar} size={14} />
			<span class="truncate">{label}</span>
			{#if canSubstitute && slotId !== null && slotId !== ""}
				<button
					type="button"
					class="shrink-0 text-tan opacity-40 transition-colors hover:text-orange hover:opacity-100"
					onclick={() => openSubstitute(side, label)}
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

<header class="mb-3 flex items-start justify-between gap-3">
	<div class="min-w-0 flex-1">
		<h2
			class="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-bold text-tan"
		>
			{#if winnerLabel && winnerSide !== null && loserSide !== null}
				{@render nameWithEdit(winnerSide, winnerLabel, winnerAvatar, false)}
				<span class="opacity-50">v</span>
				{#if loserLabel === "Bye"}
					<span class="inline-flex min-w-0 items-center gap-1.5 opacity-50">
						<span class="truncate">Bye</span>
					</span>
				{:else if loserLabel !== null}
					{@render nameWithEdit(loserSide, loserLabel, loserAvatar, true)}
				{/if}
			{:else}
				{@render nameWithEdit("a", slotALabel, slotAAvatar, false)}
				<span class="opacity-50">v</span>
				{#if match.slot_b_id !== null}
					{@render nameWithEdit("b", slotBLabel, slotBAvatar, false)}
				{:else}
					<span class="inline-flex min-w-0 items-center gap-1.5">
						<span class="truncate">{slotBLabel}</span>
					</span>
				{/if}
			{/if}
		</h2>
		<div class="mt-1 flex items-center justify-between gap-3 text-xs text-tan">
			<span class="opacity-70">
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
			<span
				class="shrink-0 rounded-full border px-2 py-0.5 text-[11px] {statusChipClass}"
			>
				{isPlaceholder ? "awaiting prior round" : match.status}
			</span>
		</div>
	</div>
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
</header>

<div class="flex flex-col gap-3">
	{#if mapName}
		<div class="flex items-center gap-1.5 text-sm text-tan" title={mapName}>
			<img src={MAP_ICON} alt="" class="h-4 w-4 shrink-0 opacity-80" />
			<span class="truncate">{mapName}</span>
		</div>
	{/if}

	{#if match.game_id}
		<div class="rounded-lg p-3" style="background-color: #35302b;">
			{#if gameLoading && !gameData}
				<p class="text-xs text-tan opacity-60">Loading game…</p>
			{:else if gameData}
				<div class="mb-2 grid grid-cols-3 gap-2">
					<div class="rounded p-2" style="background-color: #2a2622;">
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
						<p
							class="flex items-center gap-1.5 text-sm font-bold text-[#DBDEE3]"
						>
							{#if winnerLabel}
								<PlayerAvatar avatarUrl={winnerAvatar} size={14} />
							{/if}
							<span class="truncate">{winnerLabel ?? "—"}</span>
						</p>
					</div>
					<div class="rounded p-2" style="background-color: #2a2622;">
						<p
							class="mb-0.5 flex items-center gap-1 text-[10px] font-bold text-gray-400"
						>
							<SpriteIcon
								category="icons"
								value="VICTORY_NORMAL"
								size={10}
								alt="Victory Type"
							/>
							Victory Type
						</p>
						<p class="truncate text-sm font-bold text-[#DBDEE3]">
							{victoryType ?? "—"}
						</p>
					</div>
					<div class="rounded p-2" style="background-color: #2a2622;">
						<p
							class="mb-0.5 flex items-center gap-1 text-[10px] font-bold text-gray-400"
						>
							<SpriteIcon category="icons" value="TURN" size={10} alt="Turns" />
							Turns
						</p>
						<p class="truncate text-sm font-bold text-[#DBDEE3]">
							{totalTurns ?? "—"}
						</p>
					</div>
				</div>
				{#if hasSparkline}
					<div class="rounded p-1" style="background-color: #211a12;">
						<Chart option={sparklineOption} height="60px" />
					</div>
				{/if}
			{/if}
		</div>
	{:else if isPlaceholder}
		<div
			class="rounded-lg p-3 text-xs text-tan opacity-70"
			style="background-color: #35302b;"
		>
			This match is generated once the prior round finishes. Map, result, and
			uploads aren't available yet — once both feeders report, the real match
			takes over this cell.
		</div>
	{:else}
		<div class="rounded-lg p-3" style="background-color: #35302b;">
			<div class="rounded p-2" style="background-color: #2a2622;">
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
				<p class="flex items-center gap-1.5 text-sm font-bold text-[#DBDEE3]">
					{#if winnerLabel}
						<PlayerAvatar avatarUrl={winnerAvatar} size={14} />
					{/if}
					<span class="truncate">{winnerLabel ?? "—"}</span>
				</p>
			</div>
		</div>
	{/if}

	{#if editMode === "none"}
		{#if hasSecondaryActions}
			<div class="flex flex-wrap gap-2">
				{#if canUploadAsParticipant}
					<a
						class="inline-flex items-center gap-2 rounded-lg border border-[#4a433b] px-4 py-2 text-sm text-tan transition-colors hover:border-orange hover:text-orange"
						href="{resolve(
							'/upload',
						)}?tournament_match_id={match.match_id}&return_slug={tournament.slug}"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4"
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
						class="inline-flex items-center gap-2 rounded-lg border border-[#4a433b] px-4 py-2 text-sm text-tan transition-colors hover:border-orange hover:text-orange"
						href="{resolve(
							'/upload',
						)}?tournament_match_id={match.match_id}&return_slug={tournament.slug}&observer=1"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4"
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
				{#if canEditMap}
					<button
						type="button"
						class="inline-flex items-center gap-2 rounded-lg border border-[#4a433b] px-4 py-2 text-sm text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
						onclick={openMapEdit}
						disabled={busy}
					>
						Change map
					</button>
				{/if}
				{#if canRetroEdit}
					<button
						type="button"
						class="inline-flex items-center gap-2 rounded-lg border border-[#4a433b] px-4 py-2 text-sm text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
						onclick={openRetroEdit}
						disabled={busy}
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="h-4 w-4"
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
		{/if}

		{#if match.game_id}
			<div class="flex justify-end border-t border-[#4a433b] pt-3">
				<a
					class="rounded-lg border border-amber-300 bg-amber-700/40 px-4 py-2 text-sm text-amber-300 transition-colors hover:bg-amber-700/50"
					href={resolve("/games/[id]", { id: match.game_id })}
				>
					View full game
				</a>
			</div>
		{/if}
	{:else if editMode === "map"}
		<div
			class="flex flex-col gap-2 rounded-lg p-3"
			style="background-color: #35302b;"
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
			<div class="flex justify-end gap-2">
				<button
					type="button"
					class="rounded border border-tan px-3 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
					onclick={() => (editMode = "none")}
					disabled={busy}
				>
					Cancel
				</button>
				<button
					type="button"
					class="bg-orange/20 hover:bg-orange/40 rounded border border-tan px-3 py-1 text-xs text-tan disabled:opacity-50"
					onclick={saveMapEdit}
					disabled={busy}
				>
					Save
				</button>
			</div>
		</div>
	{:else if editMode === "retro"}
		<div
			class="flex flex-col gap-2 rounded-lg p-3"
			style="background-color: #35302b;"
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
			<div class="flex justify-end gap-2">
				<button
					type="button"
					class="rounded border border-tan px-3 py-1 text-xs text-tan transition-colors hover:border-orange hover:text-orange disabled:opacity-50"
					onclick={() => (editMode = "none")}
					disabled={busy}
				>
					Cancel
				</button>
				<button
					type="button"
					class="bg-orange/20 hover:bg-orange/40 rounded border border-tan px-3 py-1 text-xs text-tan disabled:opacity-50"
					onclick={saveRetroEdit}
					disabled={busy}
				>
					Save
				</button>
			</div>
		</div>
	{/if}
</div>
