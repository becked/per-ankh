// Web Worker entry point. The SvelteKit upload UI instantiates this via
// `import ParserWorker from "$lib/parser/worker?worker"` (Vite worker
// constructor). Receives a save ZIP buffer, runs the full
// extract-zip → parse-xml → orchestrator pipeline, and posts back the
// `FullGameData` blob along with the original ZIP bytes (transferable).
//
// Protocol (typed message union):
//   parent → worker: { type: "parse", file: ArrayBuffer, fileName: string }
//   worker → parent: { type: "progress", phase: string, percent: number }
//   worker → parent: { type: "result", data: FullGameData, rawZip: ArrayBuffer }
//   worker → parent: { type: "error",    message: string, code: string }
//
// Cancellation: out of scope for v1 single-file uploads — the consumer can
// drop late `result` messages by closing the modal. Future batch-upload
// flows can layer a MessageChannel per parse on top of this protocol.

/// <reference lib="webworker" />

import { ParseError, extractXmlFromZip } from "./extract-zip.js";
import { parseSaveXml } from "./parse-xml.js";
import { extractAllGameData } from "./parsers/index.js";
import type { FullGameData } from "./types.js";
import { validateCompletedGame } from "./validation.js";

export type ParseRequest = {
	type: "parse";
	file: ArrayBuffer;
	fileName: string;
};

export type ParseProgress = {
	type: "progress";
	phase: string;
	percent: number;
};

export type ParseResult = {
	type: "result";
	data: FullGameData;
	rawZip: ArrayBuffer;
};

export type ParseErrorMsg = {
	type: "error";
	message: string;
	code: string;
};

export type WorkerMessage = ParseProgress | ParseResult | ParseErrorMsg;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<ParseRequest>) => {
	if (e.data.type !== "parse") return;
	try {
		ctx.postMessage({
			type: "progress",
			phase: "Extracting ZIP",
			percent: 0,
		} satisfies ParseProgress);
		const xml = extractXmlFromZip(e.data.file);

		ctx.postMessage({
			type: "progress",
			phase: "Parsing XML",
			percent: 15,
		} satisfies ParseProgress);
		const root = parseSaveXml(xml);

		ctx.postMessage({
			type: "progress",
			phase: "Extracting game data",
			percent: 30,
		} satisfies ParseProgress);
		const gameData = extractAllGameData(root);

		validateCompletedGame(gameData);

		// Transfer rawZip (zero-copy). gameData is structured-cloned. By this
		// point the parser must not retain Uint8Array views into e.data.file
		// — transferring detaches the buffer.
		ctx.postMessage(
			{
				type: "result",
				data: gameData,
				rawZip: e.data.file,
			} satisfies ParseResult,
			{ transfer: [e.data.file] },
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const code = err instanceof ParseError ? err.code : "PARSE_ERROR";
		ctx.postMessage({
			type: "error",
			message,
			code,
		} satisfies ParseErrorMsg);
	}
};
