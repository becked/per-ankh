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
	} from "$lib/tournament/map-script-options";
	import Select from "$lib/ui/Select.svelte";
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
	let banner = $state<{ kind: "ok" | "err"; message: string } | null>(null);

	// Edit-form state lives at module scope so it survives data refreshes
	// (e.g. an invalidateAll from a sibling save) without clobbering whatever
	// the admin is currently typing. The parent is expected to wrap the modal
	// in {#key match.match_id} so navigating to a different match remounts
	// and resets these naturally.
	// svelte-ignore state_referenced_locally
	let mapScriptInput = $state(match.map_script ?? "");
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

	// Read-only list of (option, value) pairs for the match's script, used
	// in the body to communicate hosting config to players. Empty when no
	// map_script is set or the script has no applicable options.
	const matchMapOptions = $derived.by(() => {
		const script = match.map_script;
		if (!script) return [];
		const stored = tournament.map_script_options;
		return optionsForScript(script).map((option) => ({
			option,
			label: mapOptionLabel(option),
			value: mapOptionChoiceLabel(
				option,
				effectiveOptionValue(stored, script, option),
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

	// Map-script dropdown options. If the match currently references a script
	// that's no longer in allowed_map_scripts (settings were narrowed after
	// pairing), keep it as the first option so admin can see what's set and
	// retain it or change it.
	const mapScriptOptions = $derived.by(() => {
		const allowed = tournament.allowed_map_scripts;
		const current = match.map_script;
		if (!current || allowed.includes(current)) return allowed;
		return [current, ...allowed];
	});

	// --- Styled-Select option lists (retro edit mode) -----------------
	const mapSelectOptions = $derived<SelectOption[]>(
		mapScriptOptions.map((script) => ({
			value: script,
			label: tournament.allowed_map_scripts.includes(script)
				? mapScriptLabel(script)
				: `${mapScriptLabel(script)} (no longer allowed)`,
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
		banner = null;
		try {
			const out = await op();
			banner = { kind: "ok", message: successMessage };
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

	function openMapEdit() {
		mapScriptInput = match.map_script ?? "";
		editMode = "map";
	}

	async function saveMapEdit() {
		const ok = await withBusy(
			() =>
				cloudApi.patchMatchMap(tournament.tournament_id, match.match_id, {
					map_script: mapScriptInput || undefined,
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

		{#if banner}
			<div
				class="mb-3 rounded border px-3 py-2 text-xs"
				class:border-orange={banner.kind === "ok"}
				class:text-orange={banner.kind === "ok"}
				class:border-red-500={banner.kind === "err"}
				class:text-red-400={banner.kind === "err"}
				role="status"
			>
				{banner.message}
			</div>
		{/if}

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
							class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1.5 text-xs text-tan transition-colors"
							href="{resolve(
								'/upload',
							)}?tournament_match_id={match.match_id}&return_slug={tournament.slug}"
						>
							Upload save
						</a>
					{/if}
					{#if canUploadAsObserver}
						<a
							class="rounded border border-brown px-3 py-1.5 text-xs text-tan transition-colors hover:bg-brown"
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
									value={mapScriptInput}
									onChange={(v) => (mapScriptInput = v ?? "")}
									options={mapSelectOptions}
									placeholder="(no map set)"
									ariaLabel="Map"
									class="mt-1 w-full"
								/>
							</label>
							<div class="flex justify-end gap-2">
								<button
									type="button"
									class="rounded border border-brown px-3 py-1 text-xs text-tan hover:bg-brown disabled:opacity-50"
									onclick={() => (editMode = "none")}
									disabled={busy}
								>
									Cancel
								</button>
								<button
									type="button"
									class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1 text-xs text-tan disabled:opacity-50"
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
									class="rounded border border-brown px-3 py-1 text-xs text-tan hover:bg-brown disabled:opacity-50"
									onclick={() => (editMode = "none")}
									disabled={busy}
								>
									Cancel
								</button>
								<button
									type="button"
									class="bg-orange/20 hover:bg-orange/40 rounded border border-orange px-3 py-1 text-xs text-tan disabled:opacity-50"
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
