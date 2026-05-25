<script lang="ts">
	import { resolve } from "$app/paths";
	import {
		ApiError,
		cloudApi,
		type TournamentDetail,
		type TournamentMatch,
		type UserMe,
	} from "$lib/api-cloud";
	import { invalidateAll } from "$app/navigation";
	import { mapScriptLabel } from "$lib/tournament/map-scripts";
	import {
		effectiveOptionValue,
		mapOptionChoiceLabel,
		mapOptionLabel,
		optionsForScript,
		poolEntryById,
	} from "$lib/tournament/map-script-options";
	import Select from "$lib/ui/Select.svelte";
	import { toast } from "$lib/ui/toast";
	import type { SelectOption } from "$lib/ui/types";

	interface Props {
		match: TournamentMatch;
		tournament: TournamentDetail;
		slotLabels: Record<string, string>;
		slotUserIds: Record<string, string | null>;
		user: UserMe | null;
		onClose: () => void;
	}

	let { match, tournament, slotLabels, slotUserIds, user, onClose }: Props =
		$props();

	type EditMode = "none" | "map" | "retro";
	let editMode = $state<EditMode>("none");
	let busy = $state(false);

	// Edit-form state lives at module scope so it survives data refreshes
	// (e.g. an invalidateAll from a sibling save) without clobbering whatever
	// the admin is currently typing. The parent is expected to wrap the modal
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
	const slotALabel = $derived(slotLabels[match.slot_a_id] ?? "—");
	const slotBLabel = $derived(
		match.slot_b_id !== null ? (slotLabels[match.slot_b_id] ?? "—") : "Bye",
	);
	const winnerLabel = $derived(
		match.winner_slot_id !== null
			? (slotLabels[match.winner_slot_id] ?? null)
			: null,
	);
	const mapName = $derived(
		match.map_script ? mapScriptLabel(match.map_script) : null,
	);

	// The map_pool instance this match was assigned, resolved from its id.
	const matchEntry = $derived(
		poolEntryById(tournament.map_pool, match.map_pool_id),
	);

	// Read-only list of (option, value) pairs for the match's assigned instance,
	// used in the body to communicate hosting config to players. Empty when the
	// match has no instance (bye) or the script has no applicable options.
	const matchMapOptions = $derived.by(() => {
		if (!matchEntry) return [];
		return optionsForScript(matchEntry.script).map((option) => ({
			option,
			label: mapOptionLabel(option),
			value: mapOptionChoiceLabel(
				option,
				effectiveOptionValue(matchEntry.options, option),
			),
		}));
	});

	const isParticipant = $derived(
		user !== null &&
			(slotUserIds[match.slot_a_id] === user.user_id ||
				(match.slot_b_id !== null &&
					slotUserIds[match.slot_b_id] === user.user_id)),
	);
	const canUploadAsParticipant = $derived(
		isParticipant && match.status === "pending",
	);
	const canUploadAsObserver = $derived(isAdmin);
	const canEditMap = $derived(isAdmin && match.status === "pending");
	const canRetroEdit = $derived(isAdmin && match.status !== "bye");
	const retroEditLabel = $derived(
		match.status === "pending" ? "Set result" : "Edit result",
	);

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

	// Map-instance dropdown: one option per map_pool entry. If the match's
	// current instance is somehow absent from the pool, keep it as the first
	// option so admin can see what's set.
	const mapSelectOptions = $derived<SelectOption[]>([
		...(matchEntry ? [] : []),
		...tournament.map_pool.map((e) => ({
			value: e.id,
			label: instanceLabel(e),
		})),
	]);
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

	function statusBadgeClass(status: string): string {
		if (status === "complete" || status === "bye") return "text-orange";
		if (status === "in_progress") return "text-orange opacity-80";
		return "text-tan opacity-60";
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape" && !busy) {
			e.preventDefault();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
	onclick={onClose}
	role="presentation"
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border-2 border-black bg-blue-gray p-5 shadow-lg"
		onclick={(e) => e.stopPropagation()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="match-modal-title"
		tabindex="-1"
	>
		<header class="mb-3 flex items-start justify-between gap-3">
			<div class="min-w-0 flex-1">
				<h2 id="match-modal-title" class="truncate text-lg font-bold text-tan">
					<span class:text-orange={match.winner_slot_id === match.slot_a_id}>
						{slotALabel}
					</span>
					<span class="opacity-60">vs</span>
					<span class:text-orange={match.winner_slot_id === match.slot_b_id}>
						{slotBLabel}
					</span>
				</h2>
				<p class="mt-1 text-xs text-tan opacity-70">
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
					{#if mapName}
						· {mapName}
					{/if}
					<span class="ml-2 {statusBadgeClass(match.status)}">
						{match.status}
					</span>
					{#if winnerLabel}
						· winner:
						<span class="text-orange">{winnerLabel}</span>
					{/if}
				</p>
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
			{#if matchMapOptions.length > 0}
				<dl
					class="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 rounded-lg p-3 text-xs text-tan"
					style="background-color: #35302B;"
				>
					{#each matchMapOptions as opt (opt.option)}
						<dt class="opacity-70">{opt.label}</dt>
						<dd class="text-orange">{opt.value}</dd>
					{/each}
				</dl>
			{/if}

			{#if canUploadAsParticipant || canUploadAsObserver}
				<div
					class="flex flex-wrap items-center gap-2 rounded-lg p-3"
					style="background-color: #35302B;"
				>
					{#if canUploadAsParticipant}
						<a
							class="bg-orange/20 hover:bg-orange/40 rounded border border-tan px-3 py-1.5 text-xs text-tan transition-colors"
							href="{resolve(
								'/upload',
							)}?tournament_match_id={match.match_id}&return_slug={tournament.slug}"
						>
							Upload save
						</a>
					{/if}
					{#if canUploadAsObserver}
						<a
							class="rounded border border-tan px-3 py-1.5 text-xs text-tan transition-colors hover:border-orange hover:text-orange"
							href="{resolve(
								'/upload',
							)}?tournament_match_id={match.match_id}&return_slug={tournament.slug}&observer=1"
						>
							Upload save (observer)
						</a>
					{/if}
				</div>
			{/if}

			{#if canEditMap || canRetroEdit}
				<div class="rounded-lg p-3" style="background-color: #35302B;">
					{#if editMode === "none"}
						<div class="flex flex-wrap gap-2">
							{#if canEditMap}
								<button
									type="button"
									class="rounded border border-black px-2 py-1 text-xs text-tan hover:bg-[#2a2622] disabled:opacity-50"
									onclick={openMapEdit}
									disabled={busy}
								>
									Change map
								</button>
							{/if}
							{#if canRetroEdit}
								<button
									type="button"
									class="rounded border border-black px-2 py-1 text-xs text-tan hover:bg-[#2a2622] disabled:opacity-50"
									onclick={openRetroEdit}
									disabled={busy}
								>
									{retroEditLabel}
								</button>
							{/if}
						</div>
					{:else if editMode === "map"}
						<div class="flex flex-col gap-2">
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
						<div class="flex flex-col gap-2">
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
			{/if}

			{#if match.game_id}
				<a
					class="rounded-lg p-3 text-xs text-orange transition-colors hover:bg-[#35302B]"
					href={resolve("/games/[id]", { id: match.game_id })}
				>
					View full game →
				</a>
			{/if}
		</div>
	</div>
</div>
