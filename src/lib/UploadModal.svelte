<script lang="ts">
	// Cloud upload flow:
	//   1. User picks a save .zip
	//   2. Web Worker parses → FullGameData + rawZip (transferable)
	//   3. If ≥2 humans, show player picker (pre-checked from prior uploads
	//      via cloudApi.getMyOnlineIds()); else auto-skip with the sole human.
	//   4. Gzip the FullGameData JSON in-browser (CompressionStream).
	//   5. POST multipart to /v1/games. On 201, navigate to /games/{id}.
	//   6. On 409 (DuplicateUploadError), surface link to existing game.

	import { goto } from "$app/navigation";
	import ParserWorker from "$lib/parser/worker?worker";
	import type { FullGameData, PlayerRosterEntry } from "$lib/parser/types";
	import type { WorkerMessage } from "$lib/parser/worker";
	import {
		cloudApi,
		ApiError,
		DuplicateUploadError,
	} from "$lib/api-cloud";

	type Status =
		| { kind: "idle" }
		| { kind: "parsing"; phase: string; percent: number }
		| {
				kind: "picker";
				data: FullGameData;
				rawZip: ArrayBuffer;
				humans: PlayerRosterEntry[];
				selected: Set<number>;
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
	// this set when it opens; if the fetch hasn't finished by then, no rows
	// are pre-checked (acceptable degradation — user just clicks).
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

	function onParsed(data: FullGameData, rawZip: ArrayBuffer, fileName: string) {
		const humans = data.player_roster.filter((p) => p.is_human);

		if (humans.length === 0) {
			status = {
				kind: "error",
				message: "No human players found in this save",
			};
			return;
		}

		if (humans.length === 1) {
			// Auto-skip picker for singleplayer. Sole human is the uploader.
			void doUpload(data, rawZip, fileName, [humans[0].player_index]);
			return;
		}

		// Multi-human: pre-check rows whose online_id matches any of ours.
		const selected = new Set<number>(
			humans
				.filter((h) => h.online_id && knownOnlineIds.has(h.online_id))
				.map((h) => h.player_index),
		);
		status = { kind: "picker", data, rawZip, humans, selected, fileName };
	}

	function togglePicker(playerIndex: number) {
		if (status.kind !== "picker") return;
		const next = new Set(status.selected);
		if (next.has(playerIndex)) next.delete(playerIndex);
		else next.add(playerIndex);
		status = { ...status, selected: next };
	}

	async function submitPicker() {
		if (status.kind !== "picker") return;
		if (status.selected.size === 0) return;
		await doUpload(
			status.data,
			status.rawZip,
			status.fileName,
			[...status.selected],
		);
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
		uploaderIndexes: number[],
	) {
		status = { kind: "uploading", fileName };

		const blobGz = await gzipJson(data);
		const form = new FormData();
		form.append("data", blobGz, "game.json.gz");
		form.append("save", new Blob([rawZip], { type: "application/zip" }), fileName);
		form.append("uploader_player_indexes", JSON.stringify(uploaderIndexes));

		try {
			const res = await cloudApi.uploadGame(form);
			status = { kind: "done", gameId: res.game_id };
			// Refresh known ids — we just learned a new one if the picked
			// player had an online_id.
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
			This save has multiple human players. Pick the player(s) that
			belong to your account. We'll remember and pre-check next time.
		</p>
		<ul class="mb-4 space-y-2">
			{#each status.humans as human (human.player_index)}
				<li>
					<label class="flex cursor-pointer items-center gap-3 rounded border border-brown p-2 hover:bg-brown/30">
						<input
							type="checkbox"
							checked={status.selected.has(human.player_index)}
							onchange={() => togglePicker(human.player_index)}
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
				disabled={status.selected.size === 0}
				class="rounded bg-orange px-4 py-1 text-sm font-bold text-white hover:bg-orange/80 disabled:opacity-50"
			>
				Upload
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
