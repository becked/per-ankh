<script lang="ts">
	// Cloud upload flow:
	//   1. User picks a save .zip
	//   2. Web Worker parses → FullGameData + rawZip (transferable)
	//   3. Picker is always shown (even for single-human saves) — radio
	//      buttons over the human players plus a "None / observer" option.
	//      Default selection: a human whose online_id is in the user's
	//      knownOnlineIds set; otherwise null (observer).
	//   4. Gzip the FullGameData JSON in-browser (CompressionStream).
	//   5. POST multipart to /v1/games. On 201, navigate to /games/{id}.
	//   6. On 409 (DuplicateUploadError), surface link to existing game.
	//
	// "Observer mode" (`uploaderIndex === null`) means the uploader has no
	// claim on any player — covers tournament admins archiving matches and
	// users uploading a friend's save. Server records games.user_nation
	// and games.user_won as NULL, no is_uploader=TRUE rows, no online_id
	// captured into user_online_ids.

	import { goto } from "$app/navigation";
	import ParserWorker from "$lib/parser/worker?worker";
	import type { FullGameData, PlayerRosterEntry } from "$lib/parser/types";
	import type { WorkerMessage } from "$lib/parser/worker";
	import {
		cloudApi,
		ApiError,
		DuplicateUploadError,
	} from "$lib/api-cloud";

	const OBSERVER: null = null;

	type Status =
		| { kind: "idle" }
		| { kind: "parsing"; phase: string; percent: number }
		| {
				kind: "picker";
				data: FullGameData;
				rawZip: ArrayBuffer;
				humans: PlayerRosterEntry[];
				selected: number | null;
				fileName: string;
		  }
		| { kind: "uploading"; fileName: string }
		| { kind: "duplicate"; existingGameId: string }
		| { kind: "done"; gameId: string }
		| { kind: "error"; message: string };

	let status = $state<Status>({ kind: "idle" });
	let worker: Worker | null = null;
	let knownOnlineIds = $state<Set<string>>(new Set());

	function reset() {
		worker?.terminate();
		worker = null;
		status = { kind: "idle" };
	}

	// Fetch the user's known online_ids in the background. The picker reads
	// this set when it opens; if the fetch hasn't finished by then, the
	// default just falls back to "observer" (acceptable degradation).
	async function refreshKnownOnlineIds() {
		try {
			const ids = await cloudApi.getMyOnlineIds();
			knownOnlineIds = new Set(ids);
		} catch (err) {
			console.warn("Failed to fetch known online_ids:", err);
			knownOnlineIds = new Set();
		}
	}

	$effect(() => {
		refreshKnownOnlineIds();
	});

	async function onPick(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		input.value = "";

		const buffer = await file.arrayBuffer();
		status = { kind: "parsing", phase: "Starting", percent: 0 };

		worker?.terminate();
		worker = new ParserWorker();
		worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
			const msg = ev.data;
			if (msg.type === "progress") {
				status = { kind: "parsing", phase: msg.phase, percent: msg.percent };
			} else if (msg.type === "result") {
				worker?.terminate();
				worker = null;
				onParsed(msg.data, msg.rawZip, file.name);
			} else {
				worker?.terminate();
				worker = null;
				status = { kind: "error", message: `${msg.code}: ${msg.message}` };
			}
		};
		worker.postMessage(
			{ type: "parse", file: buffer, fileName: file.name },
			{ transfer: [buffer] },
		);
	}

	// Pick a sensible default: if exactly one human's online_id matches the
	// uploader's known ids, pre-select that human. Anything else (zero
	// matches, or ambiguous multiple matches) defaults to observer so we
	// never make an auto-claim that's wrong.
	function defaultSelection(humans: PlayerRosterEntry[]): number | null {
		const matches = humans.filter(
			(h) => h.online_id && knownOnlineIds.has(h.online_id),
		);
		return matches.length === 1 ? matches[0].player_index : OBSERVER;
	}

	function onParsed(data: FullGameData, rawZip: ArrayBuffer, fileName: string) {
		const humans = data.player_roster.filter((p) => p.is_human);
		// Note: we don't error on humans.length === 0 anymore — an all-AI
		// save is technically valid for archival upload (observer mode).
		status = {
			kind: "picker",
			data,
			rawZip,
			humans,
			selected: defaultSelection(humans),
			fileName,
		};
	}

	function selectPlayer(value: number | null) {
		if (status.kind !== "picker") return;
		status = { ...status, selected: value };
	}

	const submitLabel = $derived.by(() => {
		if (status.kind !== "picker") return "";
		// Local copy so the .find() closure keeps the narrowed type.
		const picker = status;
		if (picker.selected === OBSERVER) return "Upload as observer";
		const human = picker.humans.find(
			(h) => h.player_index === picker.selected,
		);
		return human ? `Upload as ${human.player_name}` : "Upload";
	});

	async function submitPicker() {
		if (status.kind !== "picker") return;
		await doUpload(status.data, status.rawZip, status.fileName, status.selected);
	}

	async function gzipJson(obj: unknown): Promise<Blob> {
		const json = JSON.stringify(obj);
		const stream = new Blob([json])
			.stream()
			.pipeThrough(new CompressionStream("gzip"));
		return new Response(stream).blob();
	}

	async function doUpload(
		data: FullGameData,
		rawZip: ArrayBuffer,
		fileName: string,
		uploaderIndex: number | null,
	) {
		status = { kind: "uploading", fileName };

		const blobGz = await gzipJson(data);
		const form = new FormData();
		form.append("data", blobGz, "game.json.gz");
		form.append("save", new Blob([rawZip], { type: "application/zip" }), fileName);
		form.append("uploader_player_index", JSON.stringify(uploaderIndex));

		try {
			const res = await cloudApi.uploadGame(form);
			status = { kind: "done", gameId: res.game_id };
			// Refresh known ids — we just learned one if the picked human
			// had an online_id (observer uploads don't change the set).
			void refreshKnownOnlineIds();
			await goto(`/games/${res.game_id}`);
		} catch (err) {
			if (err instanceof DuplicateUploadError) {
				status = { kind: "duplicate", existingGameId: err.existingGameId };
				return;
			}
			const message =
				err instanceof ApiError
					? `${err.code ?? err.status}: ${err.message}`
					: err instanceof Error
						? err.message
						: "Upload failed";
			status = { kind: "error", message };
		}
	}
</script>

<div class="rounded border-2 border-brown bg-[#2a2622] p-6">
	{#if status.kind === "idle"}
		<label class="block">
			<span class="mb-2 block text-sm font-bold text-tan">
				Pick a save zip
			</span>
			<input
				type="file"
				accept=".zip"
				onchange={onPick}
				class="block w-full text-sm text-tan file:mr-4 file:rounded file:border-0 file:bg-brown file:px-4 file:py-2 file:text-sm file:font-bold file:text-tan hover:file:bg-orange"
			/>
		</label>
	{:else if status.kind === "parsing"}
		<p class="mb-2 text-sm text-tan">
			{status.phase} — {status.percent}%
		</p>
		<progress value={status.percent} max={100} class="w-full"></progress>
	{:else if status.kind === "picker"}
		<h2 class="mb-1 text-lg font-bold text-tan">Which player is you?</h2>
		<p class="mb-4 text-xs text-brown">
			Pick the player that belongs to your account, or "None" if
			you're uploading on someone else's behalf (e.g. archiving a
			tournament match or a friend's game).
		</p>
		<ul class="mb-4 space-y-2">
			{#each status.humans as human (human.player_index)}
				<li>
					<label class="flex cursor-pointer items-center gap-3 rounded border border-brown p-2 hover:bg-brown/30">
						<input
							type="radio"
							name="uploader-pick"
							checked={status.selected === human.player_index}
							onchange={() => selectPlayer(human.player_index)}
						/>
						<div class="flex-1 text-sm text-tan">
							<div class="font-bold">{human.player_name}</div>
							<div class="text-xs text-brown">
								{human.nation ?? "—"}
								{#if human.online_id}
									<span class="ml-2 font-mono">
										id:{human.online_id.slice(0, 8)}…
									</span>
								{/if}
							</div>
						</div>
					</label>
				</li>
			{/each}
			<li>
				<label class="flex cursor-pointer items-center gap-3 rounded border border-dashed border-brown p-2 hover:bg-brown/30">
					<input
						type="radio"
						name="uploader-pick"
						checked={status.selected === null}
						onchange={() => selectPlayer(null)}
					/>
					<div class="flex-1 text-sm text-tan">
						<div class="font-bold">None — I'm just uploading this</div>
						<div class="text-xs text-brown">
							No player attribution. Game appears in your library
							as "Observed".
						</div>
					</div>
				</label>
			</li>
		</ul>
		<div class="flex justify-between">
			<button
				type="button"
				onclick={reset}
				class="rounded bg-brown/40 px-3 py-1 text-sm text-tan hover:bg-brown"
			>
				Cancel
			</button>
			<button
				type="button"
				onclick={submitPicker}
				class="rounded bg-orange px-4 py-1 text-sm font-bold text-white hover:bg-orange/80"
			>
				{submitLabel}
			</button>
		</div>
	{:else if status.kind === "uploading"}
		<p class="text-sm text-tan">Uploading {status.fileName}…</p>
	{:else if status.kind === "duplicate"}
		<p class="mb-3 text-sm text-tan">
			You've already uploaded this save.
		</p>
		<a
			class="text-sm font-bold text-orange underline"
			href={`/games/${status.existingGameId}`}
		>
			Open the existing game →
		</a>
		<div class="mt-4">
			<button
				type="button"
				onclick={reset}
				class="rounded bg-brown/40 px-3 py-1 text-sm text-tan hover:bg-brown"
			>
				Pick another file
			</button>
		</div>
	{:else if status.kind === "done"}
		<p class="text-sm text-tan">Uploaded. Redirecting…</p>
	{:else}
		<p class="mb-2 font-bold text-orange">Upload failed</p>
		<p class="mb-4 break-words text-sm text-tan">{status.message}</p>
		<button
			type="button"
			onclick={reset}
			class="rounded bg-brown px-3 py-1 text-sm font-bold text-tan hover:bg-orange"
		>
			Try again
		</button>
	{/if}
</div>
