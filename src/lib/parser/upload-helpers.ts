// Shared helpers for cloud upload flows (single-file UploadModal and bulk
// BulkUploadModal). Extracted to avoid divergence between the two modals.

import type { FullGameData, PlayerRosterEntry } from "./types";
import type { WorkerMessage } from "./worker";

// Gzip an arbitrary value's JSON encoding to a Blob via CompressionStream.
// Used to build the `data` form field for POST /v1/games.
export async function gzipJson(obj: unknown): Promise<Blob> {
	const json = JSON.stringify(obj);
	const stream = new Blob([json])
		.stream()
		.pipeThrough(new CompressionStream("gzip"));
	return new Response(stream).blob();
}

// Pick a sensible default uploader: if exactly one human's online_id matches
// the user's known ids, pre-select that human. Anything else (zero matches,
// or ambiguous multiple matches) defaults to observer (null) so we never
// auto-claim incorrectly.
export function defaultSelection(
	humans: PlayerRosterEntry[],
	knownOnlineIds: Set<string>,
): number | null {
	const matches = humans.filter(
		(h) => h.online_id && knownOnlineIds.has(h.online_id),
	);
	return matches.length === 1 ? matches[0].player_index : null;
}

export type ParseProgressCb = (phase: string, percent: number) => void;

export class ParseFailure extends Error {
	constructor(
		public code: string,
		message: string,
	) {
		super(message);
		this.name = "ParseFailure";
	}
}

// Promise-wrapped parse against a persistent Worker. The caller owns the
// Worker lifecycle (spawn once, reuse across many files, terminate on
// teardown). Only one parse runs at a time on a given Worker — callers
// serialize via await.
//
// `buffer` is transferred to the Worker; do not reuse it on the main side
// after this call. The Worker transfers it back inside the resolved
// `rawZip`, so ownership returns to the caller on success.
export function parseSaveFile(
	buffer: ArrayBuffer,
	fileName: string,
	worker: Worker,
	onProgress?: ParseProgressCb,
): Promise<{ data: FullGameData; rawZip: ArrayBuffer }> {
	return new Promise((resolve, reject) => {
		worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
			const msg = ev.data;
			if (msg.type === "progress") {
				onProgress?.(msg.phase, msg.percent);
			} else if (msg.type === "result") {
				resolve({ data: msg.data, rawZip: msg.rawZip });
			} else {
				reject(new ParseFailure(msg.code, msg.message));
			}
		};
		worker.postMessage(
			{ type: "parse", file: buffer, fileName },
			{ transfer: [buffer] },
		);
	});
}
