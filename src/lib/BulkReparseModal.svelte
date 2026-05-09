<script lang="ts">
	// Bulk reparse — sweep every game whose stored parser_version is older
	// than the current PARSER_VERSION constant, fetch its raw ZIP, run it
	// through the new parser, and POST it back. The Worker recognizes the
	// (user_id, file_hash) collision + newer parser_version as an in-place
	// overwrite (cloud/src/games.ts handleGameUpload re-import branch).
	//
	// Differences vs BulkUploadModal:
	//   - Inputs are existing games, not picked files. No file picker.
	//   - uploader_player_index is recovered from the existing
	//     `games.user_nation`: find the unique human in the freshly parsed
	//     roster whose nation matches; observer originals (user_nation =
	//     null) re-upload as observer.
	//   - Sequential pipeline (download → parse → upload) per game; the
	//     parser worker is single-threaded so concurrency wouldn't speed up
	//     the bottleneck and would complicate UI state.

	import ParserWorker from "$lib/parser/worker?worker";
	import {
		gzipJson,
		parseSaveFile,
		ParseFailure,
	} from "$lib/parser/upload-helpers";
	import {
		cloudApi,
		ApiError,
		DuplicateUploadError,
		type GameListItem,
	} from "$lib/api-cloud";

	type RowStatus =
		| { kind: "queued" }
		| { kind: "downloading" }
		| { kind: "parsing"; phase: string; percent: number }
		| { kind: "uploading" }
		| { kind: "done"; reimported: boolean }
		| { kind: "duplicate" }
		| { kind: "error"; message: string };

	interface Row {
		gameId: string;
		gameName: string;
		userNation: string | null;
		status: RowStatus;
	}

	let {
		games,
		onClose,
	}: {
		games: GameListItem[];
		// eslint-disable-next-line no-unused-vars -- callback type parameter name is documentation
		onClose: (didReparse: boolean) => void;
	} = $props();

	type Phase = "idle" | "running" | "done";

	let phase = $state<Phase>("idle");
	// Snapshot of the eligible games at modal-open time. The prop is
	// effectively immutable for the modal's lifetime ({#if reparseOpen}
	// remounts on each open), so capturing once is intentional.
	// svelte-ignore state_referenced_locally
	let rows = $state<Row[]>(
		games.map((g) => ({
			gameId: g.game_id,
			gameName: g.game_name ?? "Unnamed game",
			userNation: g.user_nation,
			status: { kind: "queued" },
		})),
	);
	let worker: Worker | null = null;
	let cancelled = false;

	$effect(() => {
		return () => {
			worker?.terminate();
			worker = null;
		};
	});

	const summary = $derived.by(() => {
		let done = 0;
		let duplicate = 0;
		let failed = 0;
		for (const r of rows) {
			if (r.status.kind === "done") done++;
			else if (r.status.kind === "duplicate") duplicate++;
			else if (r.status.kind === "error") failed++;
		}
		return { done, duplicate, failed };
	});

	function setStatus(gameId: string, status: RowStatus) {
		const r = rows.find((row) => row.gameId === gameId);
		if (r) r.status = status;
	}

	async function processOne(row: Row): Promise<void> {
		// Download
		setStatus(row.gameId, { kind: "downloading" });
		let rawZip: ArrayBuffer;
		let fileName: string;
		try {
			const dl = await cloudApi.downloadGame(row.gameId);
			rawZip = await dl.blob.arrayBuffer();
			fileName = dl.filename;
		} catch (err) {
			setStatus(row.gameId, {
				kind: "error",
				message: `Download failed: ${err instanceof Error ? err.message : String(err)}`,
			});
			return;
		}

		// Parse
		setStatus(row.gameId, {
			kind: "parsing",
			phase: "Starting",
			percent: 0,
		});
		worker ??= new ParserWorker();
		let data, parsedZip: ArrayBuffer;
		try {
			const result = await parseSaveFile(rawZip, fileName, worker, (p, pct) => {
				setStatus(row.gameId, { kind: "parsing", phase: p, percent: pct });
			});
			data = result.data;
			parsedZip = result.rawZip;
		} catch (err) {
			const message =
				err instanceof ParseFailure
					? `${err.code}: ${err.message}`
					: err instanceof Error
						? err.message
						: "Parse failed";
			setStatus(row.gameId, { kind: "error", message });
			return;
		}

		// Derive uploader index from the original `user_nation`. Observer
		// originals (null) stay observer. For claimed originals, find the
		// unique human whose nation matches; ambiguous matches surface as
		// errors so we don't silently re-claim the wrong player.
		let uploaderIndex: number | null;
		if (row.userNation === null) {
			uploaderIndex = null;
		} else {
			const candidates = data.player_roster.filter(
				(p) => p.is_human && p.nation === row.userNation,
			);
			if (candidates.length === 1) {
				uploaderIndex = candidates[0].player_index;
			} else {
				setStatus(row.gameId, {
					kind: "error",
					message:
						candidates.length === 0
							? `No human player matches stored nation ${row.userNation}`
							: `Multiple human players match stored nation ${row.userNation}`,
				});
				return;
			}
		}

		// Upload
		setStatus(row.gameId, { kind: "uploading" });
		try {
			const gzippedData = await gzipJson(data);
			const form = new FormData();
			form.append("data", gzippedData, "game.json.gz");
			form.append(
				"save",
				new Blob([parsedZip], { type: "application/zip" }),
				fileName,
			);
			form.append("uploader_player_index", JSON.stringify(uploaderIndex));
			const res = await cloudApi.uploadGame(form);
			setStatus(row.gameId, {
				kind: "done",
				reimported: res.reimported === true,
			});
		} catch (err) {
			if (err instanceof DuplicateUploadError) {
				setStatus(row.gameId, { kind: "duplicate" });
				return;
			}
			const message =
				err instanceof ApiError
					? `${err.code ?? err.status}: ${err.message}`
					: err instanceof Error
						? err.message
						: "Upload failed";
			setStatus(row.gameId, { kind: "error", message });
		}
	}

	async function start() {
		if (phase !== "idle") return;
		phase = "running";
		for (const row of rows) {
			if (cancelled) break;
			await processOne(row);
		}
		phase = "done";
	}

	function cancel() {
		cancelled = true;
		worker?.terminate();
		worker = null;
		phase = "done";
	}

	function close() {
		const didReparse = summary.done > 0;
		onClose(didReparse);
	}
</script>

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
	role="dialog"
	aria-modal="true"
	aria-label="Reparse all games"
>
	<div class="w-full max-w-2xl rounded border-2 border-brown bg-[#2a2622] p-6">
		<div class="mb-4 flex items-center justify-between">
			<h2 class="font-serif text-xl text-tan">Reparse {rows.length} game{rows.length === 1 ? "" : "s"}</h2>
			{#if phase === "idle"}
				<button
					type="button"
					onclick={close}
					class="text-xs text-tan underline hover:text-orange"
				>
					Cancel
				</button>
			{/if}
		</div>

		{#if phase === "idle"}
			<p class="mb-4 text-sm text-tan">
				The parser was upgraded. Re-importing will pull each save's raw
				ZIP from cloud storage, parse it again, and update the stored
				data. Game IDs and visibility settings are preserved.
			</p>
			<div class="flex gap-2">
				<button
					type="button"
					onclick={start}
					class="rounded bg-orange px-4 py-2 text-sm font-bold text-white hover:bg-orange/80"
				>
					Start reparsing
				</button>
				<button
					type="button"
					onclick={close}
					class="rounded bg-brown px-4 py-2 text-sm text-tan hover:bg-orange"
				>
					Cancel
				</button>
			</div>
		{:else}
			<div class="mb-4 text-sm text-tan">
				{summary.done} done · {summary.duplicate} unchanged · {summary.failed} failed
			</div>
			<ul class="max-h-96 space-y-1 overflow-y-auto pr-2">
				{#each rows as row (row.gameId)}
					<li class="flex items-center gap-2 rounded bg-[#1f1c19] px-2 py-1 text-xs">
						<span class="flex-1 truncate text-tan">{row.gameName}</span>
						<span class="text-right">
							{#if row.status.kind === "queued"}
								<span class="text-brown">Queued</span>
							{:else if row.status.kind === "downloading"}
								<span class="text-tan">Downloading…</span>
							{:else if row.status.kind === "parsing"}
								<span class="text-tan">
									Parsing {row.status.percent}%
								</span>
							{:else if row.status.kind === "uploading"}
								<span class="text-tan">Uploading…</span>
							{:else if row.status.kind === "done"}
								<span class="font-bold text-green-500">
									{row.status.reimported ? "Updated" : "Uploaded"}
								</span>
							{:else if row.status.kind === "duplicate"}
								<span class="text-brown">No change</span>
							{:else if row.status.kind === "error"}
								<span class="text-orange" title={row.status.message}>
									Failed
								</span>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
			<div class="mt-4 flex gap-2">
				{#if phase === "running"}
					<button
						type="button"
						onclick={cancel}
						class="rounded bg-brown px-4 py-2 text-sm text-tan hover:bg-orange"
					>
						Stop
					</button>
				{:else}
					<button
						type="button"
						onclick={close}
						class="rounded bg-orange px-4 py-2 text-sm font-bold text-white hover:bg-orange/80"
					>
						Close
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>
