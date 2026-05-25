<script lang="ts">
	// Bulk cloud upload — pick up to MAX_FILES saves at once.
	//
	// Flow:
	//   1. User picks N files (1 ≤ N ≤ MAX_FILES) via the multi-select input.
	//   2. Each file goes through parse → ready → upload with its own row.
	//      Parsing is sequential on a single persistent Worker; uploads run
	//      with bounded concurrency (UPLOAD_CONCURRENCY).
	//   3. As soon as a file parses, we gzip the FullGameData JSON to a Blob
	//      and drop the parsed JS object — only rawZip + gzipped data stay
	//      resident, keeping memory bounded for full-batch picking. See
	//      docs/plans/multi-upload (gzip-on-parse strategy).
	//   4. Per-row picker prompts "which player are you?" with the same
	//      auto-default heuristic as the single-file modal.
	//   5. Failures are per-row: parse/upload errors don't abort the batch,
	//      and failed uploads can be retried inline.
	//   6. After all rows reach a terminal state, "Done" navigates to /games.
	//
	// The single-file UploadModal.svelte is unchanged — it's used by
	// ReimportButton's `prefilled` flow which is inherently single-file.

	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import ParserWorker from "$lib/parser/worker?worker";
	import type { PlayerRosterEntry } from "$lib/parser/types";
	import {
		gzipJson,
		defaultSelection,
		parseSaveFile,
		ParseFailure,
	} from "$lib/parser/upload-helpers";
	import { cloudApi, ApiError, DuplicateUploadError } from "$lib/api-cloud";
	import { formatEnum } from "$lib/utils/formatting";
	import RadioGroup from "$lib/ui/RadioGroup.svelte";
	import RadioItem from "$lib/ui/RadioItem.svelte";

	// bits-ui RadioGroup is string-only; this sentinel maps to observer (null).
	const OBSERVER_RADIO = "__observer__";

	const MAX_FILES = 25;
	const UPLOAD_CONCURRENCY = 3;

	type RowStatus =
		| { kind: "queued" }
		| { kind: "parsing"; phase: string; percent: number }
		| {
				kind: "ready";
				humans: PlayerRosterEntry[];
				// `selected` is the participant's player_index (for normal
				// uploads and tournament-participant uploads), or null for the
				// non-tournament Observer mode. In tournament-observer mode
				// (admin uploading on behalf), it stays null and the slot
				// mappings below carry the player choices instead.
				selected: number | null;
				// Tournament-observer mode only: which roster index corresponds
				// to slot A / slot B in the match. Both must be set + distinct
				// before upload can proceed.
				slotAPlayerIndex: number | null;
				slotBPlayerIndex: number | null;
				rawZip: Blob;
				gzippedData: Blob;
		  }
		| { kind: "uploading" }
		| { kind: "uploaded"; gameId: string; reimported: boolean }
		| { kind: "duplicate"; existingGameId: string }
		| {
				kind: "error";
				message: string;
				// Present only on upload-stage errors. Parse-stage errors set
				// this to null since rawZip/gzippedData were never produced —
				// the user must Remove + re-pick to retry those.
				retry: {
					humans: PlayerRosterEntry[];
					selected: number | null;
					slotAPlayerIndex: number | null;
					slotBPlayerIndex: number | null;
					rawZip: Blob;
					gzippedData: Blob;
				} | null;
		  };

	interface Row {
		id: number;
		fileName: string;
		status: RowStatus;
	}

	type Phase = "picking" | "uploading" | "done";

	let {
		onBusyChange,
		tournamentMatchId,
		observerMode,
		slotALabel,
		slotBLabel,
		doneRedirect,
	}: {
		// Fires when the modal enters or leaves an active parse/upload phase.
		// Hosts use this to drive the HieroglyphParade — marching while busy,
		// static borders otherwise.
		// eslint-disable-next-line no-unused-vars -- Callback type signature
		onBusyChange?: (busy: boolean) => void;
		// Optional tournament-match link. When present, the upload form
		// includes the field; the worker validates participation, force-
		// publics the game, and assigns it to the user's "Tournament: {name}"
		// collection.
		tournamentMatchId?: string | null;
		// True when an admin is uploading on behalf of the match's
		// participants. Switches the per-row picker from "which player are
		// you?" to a slot-mapping picker for slot A only (slot B is inferred
		// from the other human in the roster, since tournament matches have
		// exactly 2 humans).
		observerMode?: boolean;
		slotALabel?: string;
		slotBLabel?: string;
		// Where the Done button navigates after a finished upload session.
		// Defaults to the uploader's profile page. Tournament upload flows
		// pass the match page so the admin/player returns to the match
		// they were on.
		doneRedirect?: string;
	} = $props();

	let rows = $state<Row[]>([]);
	let phase = $state<Phase>("picking");
	let pickError = $state<string | null>(null);
	let knownOnlineIds = $state<Set<string>>(new Set());
	let worker: Worker | null = null;
	let nextId = 1;

	$effect(() => {
		refreshKnownOnlineIds();
		return () => {
			worker?.terminate();
			worker = null;
		};
	});

	const isBusy = $derived(
		phase === "uploading" || rows.some((r) => r.status.kind === "parsing"),
	);
	$effect(() => {
		onBusyChange?.(isBusy);
	});

	async function refreshKnownOnlineIds() {
		try {
			const ids = await cloudApi.getMyOnlineIds();
			knownOnlineIds = new Set(ids);
		} catch (err) {
			console.warn("Failed to fetch known online_ids:", err);
			knownOnlineIds = new Set();
		}
	}

	async function onPick(event: Event) {
		const input = event.target as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = "";
		if (files.length === 0) return;
		if (files.length > MAX_FILES) {
			pickError = `Too many files (${files.length}). Max ${MAX_FILES} per batch.`;
			return;
		}
		pickError = null;

		const enqueued: Array<{ id: number; file: File }> = files.map((file) => {
			const id = nextId++;
			rows.push({ id, fileName: file.name, status: { kind: "queued" } });
			return { id, file };
		});

		await parseAll(enqueued);
	}

	async function parseAll(items: Array<{ id: number; file: File }>) {
		worker ??= new ParserWorker();
		for (const { id, file } of items) {
			const row = rows.find((r) => r.id === id);
			if (!row || row.status.kind !== "queued") continue;

			row.status = { kind: "parsing", phase: "Starting", percent: 0 };
			try {
				const buffer = await file.arrayBuffer();
				const { data, rawZip } = await parseSaveFile(
					buffer,
					file.name,
					worker,
					(p, pct) => {
						// Row may have been removed mid-parse (we don't allow this
						// today, but be defensive).
						const r = rows.find((r) => r.id === id);
						if (r && r.status.kind === "parsing") {
							r.status = { kind: "parsing", phase: p, percent: pct };
						}
					},
				);

				const gzippedData = await gzipJson(data);
				const rawZipBlob = new Blob([rawZip], { type: "application/zip" });
				const humans = data.player_roster.filter((p) => p.is_human);

				const r = rows.find((r) => r.id === id);
				if (!r) continue;
				r.status = {
					kind: "ready",
					humans,
					// In observer mode the uploader doesn't claim a slot for
					// themselves; slot mappings are entered explicitly via the
					// per-slot pickers below.
					selected: observerMode
						? null
						: defaultSelection(humans, knownOnlineIds),
					slotAPlayerIndex: null,
					slotBPlayerIndex: null,
					rawZip: rawZipBlob,
					gzippedData,
				};
			} catch (err) {
				const message =
					err instanceof ParseFailure
						? `${err.code}: ${err.message}`
						: err instanceof Error
							? err.message
							: "Parse failed";
				const r = rows.find((r) => r.id === id);
				if (r) r.status = { kind: "error", message, retry: null };
			}
		}
	}

	function selectFor(row: Row, selected: number | null) {
		if (row.status.kind !== "ready") return;
		row.status.selected = selected;
	}

	// In observer mode picking Slot A's player auto-fills Slot B as the
	// other human in the roster. Tournament matches require exactly 2
	// humans, so by-elimination is unambiguous WHEN there are exactly 2
	// humans. For any other count we leave slotBPlayerIndex null so the
	// row stays unready (see rowReadyToUpload) and the human-count error
	// banner fires; otherwise we'd silently pick a stranger as slot B and
	// only catch it server-side as WRONG_HUMAN_COUNT.
	function selectSlotAPlayer(row: Row, value: number) {
		if (row.status.kind !== "ready") return;
		row.status.slotAPlayerIndex = value;
		if (row.status.humans.length === 2) {
			const otherHuman = row.status.humans.find(
				(h) => h.player_index !== value,
			);
			row.status.slotBPlayerIndex = otherHuman?.player_index ?? null;
		} else {
			row.status.slotBPlayerIndex = null;
		}
	}

	// In observer mode the row is ready to upload only when both slot
	// mappings are set and distinct. In participant mode the existing rule
	// holds (`selected` can be a roster index or null/observer).
	function rowReadyToUpload(row: Row): boolean {
		if (row.status.kind !== "ready") return false;
		if (!observerMode) return true;
		const { slotAPlayerIndex, slotBPlayerIndex } = row.status;
		return (
			slotAPlayerIndex !== null &&
			slotBPlayerIndex !== null &&
			slotAPlayerIndex !== slotBPlayerIndex
		);
	}

	function removeRow(row: Row) {
		const idx = rows.findIndex((r) => r.id === row.id);
		if (idx === -1) return;
		rows.splice(idx, 1);
		if (rows.length === 0) {
			pickError = null;
			phase = "picking";
		}
	}

	function cancelAll() {
		worker?.terminate();
		worker = null;
		rows = [];
		phase = "picking";
		pickError = null;
	}

	const allParsed = $derived(
		rows.length > 0 &&
			rows.every(
				(r) => r.status.kind !== "queued" && r.status.kind !== "parsing",
			),
	);
	const hasReady = $derived(rows.some((r) => r.status.kind === "ready"));
	// In observer mode, "ready" requires both slot mappings set+distinct.
	// Block the Upload button until every ready row passes that check.
	const allReadyCanUpload = $derived(
		rows
			.filter((r) => r.status.kind === "ready")
			.every((r) => rowReadyToUpload(r)),
	);
	const allTerminal = $derived(
		rows.length > 0 &&
			rows.every(
				(r) =>
					r.status.kind === "uploaded" ||
					r.status.kind === "duplicate" ||
					r.status.kind === "error",
			),
	);

	const summary = $derived.by(() => {
		let uploaded = 0;
		let duplicate = 0;
		let failed = 0;
		for (const r of rows) {
			if (r.status.kind === "uploaded") uploaded++;
			else if (r.status.kind === "duplicate") duplicate++;
			else if (r.status.kind === "error") failed++;
		}
		return { uploaded, duplicate, failed };
	});

	async function uploadOne(row: Row) {
		if (row.status.kind !== "ready") return;
		const ready = row.status;
		const fileName = row.fileName;

		row.status = { kind: "uploading" };
		try {
			const form = new FormData();
			form.append("data", ready.gzippedData, "game.json.gz");
			form.append("save", ready.rawZip, fileName);
			// In observer mode the uploader doesn't claim a roster slot;
			// the worker requires uploader_player_index to be null.
			form.append(
				"uploader_player_index",
				JSON.stringify(observerMode ? null : ready.selected),
			);
			if (tournamentMatchId) {
				form.append("tournament_match_id", tournamentMatchId);
				if (observerMode) {
					if (
						ready.slotAPlayerIndex === null ||
						ready.slotBPlayerIndex === null
					) {
						throw new Error("Observer upload requires both slot mappings");
					}
					form.append(
						"tournament_slot_a_player_index",
						String(ready.slotAPlayerIndex),
					);
					form.append(
						"tournament_slot_b_player_index",
						String(ready.slotBPlayerIndex),
					);
				}
			}

			const res = await cloudApi.uploadGame(form);
			row.status = {
				kind: "uploaded",
				gameId: res.game_id,
				reimported: res.reimported === true,
			};
		} catch (err) {
			if (err instanceof DuplicateUploadError) {
				row.status = { kind: "duplicate", existingGameId: err.existingGameId };
				return;
			}
			const message =
				err instanceof ApiError
					? `${err.code ?? err.status}: ${err.message}`
					: err instanceof Error
						? err.message
						: "Upload failed";
			row.status = {
				kind: "error",
				message,
				retry: {
					humans: ready.humans,
					selected: ready.selected,
					slotAPlayerIndex: ready.slotAPlayerIndex,
					slotBPlayerIndex: ready.slotBPlayerIndex,
					rawZip: ready.rawZip,
					gzippedData: ready.gzippedData,
				},
			};
		}
	}

	async function uploadAll() {
		if (phase !== "picking") return;
		phase = "uploading";

		// Snapshot the ids we'll upload — picker phase ends here, no further
		// removes allowed.
		const targets = rows
			.filter((r) => r.status.kind === "ready")
			.map((r) => r.id);

		// Bounded-concurrency worker loop.
		let cursor = 0;
		const next = async () => {
			while (cursor < targets.length) {
				const idx = cursor++;
				const row = rows.find((r) => r.id === targets[idx]);
				if (!row) continue;
				await uploadOne(row);
			}
		};
		await Promise.all(
			Array.from(
				{ length: Math.min(UPLOAD_CONCURRENCY, targets.length) },
				next,
			),
		);

		void refreshKnownOnlineIds();
		phase = "done";
	}

	async function retryRow(row: Row) {
		if (row.status.kind !== "error" || row.status.retry === null) return;
		const retry = row.status.retry;
		row.status = {
			kind: "ready",
			humans: retry.humans,
			selected: retry.selected,
			slotAPlayerIndex: retry.slotAPlayerIndex,
			slotBPlayerIndex: retry.slotBPlayerIndex,
			rawZip: retry.rawZip,
			gzippedData: retry.gzippedData,
		};
		await uploadOne(row);
	}

	function navigateDone() {
		// Default destination is the uploader's profile (their library +
		// stats). The /upload route already gates on a session, so
		// page.data.user is set here; the resolve("/") fallback is
		// purely defensive.
		const userId = page.data.user?.user_id;
		const fallback = userId ? resolve(`/users/${userId}`) : resolve("/");
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- doneRedirect is produced by the parent via resolve(); lint can't see through the prop
		void goto(doneRedirect ?? fallback);
	}
</script>

<div class="rounded-lg p-4" style="background-color: #2a2622;">
	{#if rows.length === 0}
		<div class="rounded-lg p-3" style="background-color: #35302B;">
			<label
				class="inline-block cursor-pointer rounded bg-brown px-4 py-2 text-sm font-bold text-tan hover:bg-orange"
			>
				Choose files
				<input
					type="file"
					accept=".zip"
					multiple
					onchange={onPick}
					class="sr-only"
				/>
			</label>
			{#if pickError}
				<p class="mt-3 text-sm text-orange">{pickError}</p>
			{/if}
		</div>
	{:else}
		<div class="mb-3 flex items-center justify-between">
			<p class="text-sm" style="color: #DBDEE3;">
				{rows.length}
				{rows.length === 1 ? "save" : "saves"}
				{#if phase === "picking" && !allParsed}
					— parsing…
				{:else if phase === "uploading"}
					— uploading…
				{:else if phase === "done"}
					— {summary.uploaded} uploaded · {summary.duplicate} duplicate · {summary.failed}
					failed
				{/if}
			</p>
		</div>

		<ul class="mb-4 max-h-[60vh] space-y-2 overflow-y-auto">
			{#each rows as row (row.id)}
				<li class="rounded-lg p-3" style="background-color: #35302B;">
					<div class="mb-2 flex items-start justify-between gap-3">
						<span class="truncate text-sm font-bold" style="color: #DBDEE3;">
							{row.fileName}
						</span>
						<span
							class="shrink-0 text-xs uppercase tracking-wide text-gray-400"
						>
							{#if row.status.kind === "queued"}
								Queued
							{:else if row.status.kind === "parsing"}
								Parsing
							{:else if row.status.kind === "ready"}
								Ready
							{:else if row.status.kind === "uploading"}
								Uploading
							{:else if row.status.kind === "uploaded"}
								<span class="text-orange">
									{row.status.reimported ? "Updated" : "Uploaded"}
								</span>
							{:else if row.status.kind === "duplicate"}
								Duplicate
							{:else}
								<span class="text-orange">Failed</span>
							{/if}
						</span>
					</div>

					{#if row.status.kind === "parsing"}
						<p class="mb-1 text-xs text-gray-400">
							{row.status.phase} — {row.status.percent}%
						</p>
						<progress value={row.status.percent} max={100} class="w-full"
						></progress>
					{:else if row.status.kind === "ready"}
						{@const ready = row.status}
						{#if observerMode}
							{#if ready.humans.length !== 2}
								<p class="mb-2 text-xs text-orange">
									Tournament matches require exactly 2 humans in the save; got
									{ready.humans.length}. Cannot upload.
								</p>
							{/if}
							<p class="text-xs text-gray-400">
								{slotALabel ?? "Slot A"} played as:
							</p>
							<RadioGroup
								value={ready.slotAPlayerIndex === null
									? ""
									: String(ready.slotAPlayerIndex)}
								onChange={(v) => selectSlotAPlayer(row, Number(v))}
								disabled={phase !== "picking"}
								ariaLabel="Slot A player"
								class="mt-1 block space-y-1"
							>
								{#each ready.humans as human (human.player_index)}
									<label
										class="flex cursor-pointer items-center gap-2 text-sm text-tan"
									>
										<RadioItem value={String(human.player_index)} />
										<span class="font-bold">
											{human.player_name ||
												formatEnum(human.nation, "NATION_") ||
												"—"}
										</span>
										{#if human.player_name}
											<span class="text-xs text-gray-400">
												{formatEnum(human.nation, "NATION_") ?? "—"}
											</span>
										{/if}
									</label>
								{/each}
							</RadioGroup>
							{#if ready.slotBPlayerIndex !== null}
								{@const slotBHuman = ready.humans.find(
									(h) => h.player_index === ready.slotBPlayerIndex,
								)}
								<p class="mt-3 text-xs text-gray-400">
									{slotBLabel ?? "Slot B"} played as:
									<span class="text-tan">
										{slotBHuman?.player_name ||
											formatEnum(slotBHuman?.nation ?? null, "NATION_") ||
											"—"}
									</span>
									<span class="opacity-60">(auto-inferred)</span>
								</p>
							{/if}
						{:else}
							<p class="mb-2 text-xs font-bold text-gray-400">Choose player</p>
							<RadioGroup
								value={ready.selected === null
									? OBSERVER_RADIO
									: String(ready.selected)}
								onChange={(v) =>
									selectFor(row, v === OBSERVER_RADIO ? null : Number(v))}
								disabled={phase !== "picking"}
								ariaLabel="Uploading player"
								class="block space-y-1"
							>
								{#each ready.humans as human (human.player_index)}
									<label
										class="flex cursor-pointer items-center gap-2 text-sm text-tan"
									>
										<RadioItem value={String(human.player_index)} />
										<span class="font-bold">
											{human.player_name ||
												formatEnum(human.nation, "NATION_") ||
												"—"}
										</span>
										{#if human.player_name}
											<span class="text-xs text-gray-400">
												{formatEnum(human.nation, "NATION_") ?? "—"}
											</span>
										{/if}
									</label>
								{/each}
								<label
									class="flex cursor-pointer items-center gap-2 text-sm text-tan"
								>
									<RadioItem value={OBSERVER_RADIO} />
									<span class="font-bold">Observer</span>
								</label>
							</RadioGroup>
						{/if}
					{:else if row.status.kind === "uploaded"}
						<a
							class="text-xs text-orange underline"
							href={resolve("/games/[id]", { id: row.status.gameId })}
						>
							Open game →
						</a>
					{:else if row.status.kind === "duplicate"}
						<p class="text-xs" style="color: #DBDEE3;">
							Already uploaded.
							<a
								class="text-orange underline"
								href={resolve("/games/[id]", {
									id: row.status.existingGameId,
								})}
							>
								Open existing →
							</a>
						</p>
					{:else if row.status.kind === "error"}
						<p class="break-words text-xs text-orange">{row.status.message}</p>
						{#if row.status.retry !== null && phase !== "uploading"}
							<button
								type="button"
								onclick={() => retryRow(row)}
								class="bg-brown/40 mt-2 rounded px-2 py-0.5 text-xs text-tan hover:bg-brown"
							>
								Retry upload
							</button>
						{/if}
					{/if}

					{#if phase === "picking" && (row.status.kind === "ready" || row.status.kind === "error")}
						<div class="mt-2">
							<button
								type="button"
								onclick={() => removeRow(row)}
								class="text-xs text-brown underline hover:text-orange"
							>
								Remove
							</button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>

		{#if phase === "picking"}
			<div class="flex justify-between">
				<button
					type="button"
					onclick={cancelAll}
					class="bg-brown/40 rounded px-3 py-1 text-sm text-tan hover:bg-brown"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={uploadAll}
					disabled={!allParsed || !hasReady || !allReadyCanUpload}
					class="hover:bg-orange/80 rounded bg-orange px-4 py-1 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
				>
					Upload {hasReady
						? rows.filter((r) => r.status.kind === "ready").length
						: ""}
				</button>
			</div>
		{:else if phase === "uploading"}
			<p class="text-sm" style="color: #DBDEE3;">
				Uploading… please don't close this tab.
			</p>
		{:else if phase === "done"}
			<div class="flex justify-end">
				<button
					type="button"
					onclick={navigateDone}
					disabled={!allTerminal}
					class="hover:bg-orange/80 rounded bg-orange px-4 py-1 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
				>
					Done
				</button>
			</div>
		{/if}
	{/if}
</div>
