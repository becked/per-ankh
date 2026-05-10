// ZIP extraction for Old World save files.
//
// Mirrors src-tauri/src/parser/save_file.rs validation rules. Used by both
// the parity test harness (Node) and the eventual Web Worker upload path.

import { unzipSync, strFromU8 } from "fflate";

const MAX_COMPRESSED = 50 * 1024 * 1024;
const MAX_UNCOMPRESSED = 100 * 1024 * 1024;
const MAX_ENTRIES = 10;
const MAX_RATIO = 100;

export type ParseErrorCode =
	| "FILE_TOO_LARGE"
	| "EMPTY_FILE"
	| "INVALID_ARCHIVE"
	| "NO_XML"
	| "ZIP_BOMB"
	| "MISSING_FIELD"
	| "INVALID_FORMAT"
	| "NOT_COMPLETED"
	| "NO_GAME_ID"
	| "NO_PLAYERS";

export class ParseError extends Error {
	constructor(
		message: string,
		public code: ParseErrorCode,
	) {
		super(message);
		this.name = "ParseError";
	}
}

export function extractXmlFromZip(buffer: ArrayBuffer): string {
	if (buffer.byteLength === 0) {
		throw new ParseError("Empty file", "EMPTY_FILE");
	}
	if (buffer.byteLength > MAX_COMPRESSED) {
		throw new ParseError(
			`File too large: ${buffer.byteLength} > ${MAX_COMPRESSED}`,
			"FILE_TOO_LARGE",
		);
	}

	const files = unzipSync(new Uint8Array(buffer));
	const entries = Object.keys(files);
	if (entries.length > MAX_ENTRIES) {
		throw new ParseError(
			`Too many entries: ${entries.length} > ${MAX_ENTRIES}`,
			"INVALID_ARCHIVE",
		);
	}

	const xmlEntries = entries.filter((name) =>
		name.toLowerCase().endsWith(".xml"),
	);
	if (xmlEntries.length === 0) {
		throw new ParseError("No XML file found in archive", "NO_XML");
	}
	if (xmlEntries.length > 1) {
		throw new ParseError(
			"Multiple XML files found in archive",
			"INVALID_ARCHIVE",
		);
	}

	const raw = files[xmlEntries[0]];
	if (raw.byteLength > MAX_UNCOMPRESSED) {
		throw new ParseError(
			`Uncompressed XML too large: ${raw.byteLength} > ${MAX_UNCOMPRESSED}`,
			"FILE_TOO_LARGE",
		);
	}

	const ratio = raw.byteLength / buffer.byteLength;
	if (ratio > MAX_RATIO) {
		throw new ParseError(
			`Suspicious compression ratio: ${ratio.toFixed(1)}x (threshold: ${MAX_RATIO}x)`,
			"ZIP_BOMB",
		);
	}

	return strFromU8(raw);
}
