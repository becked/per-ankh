// Cloud-blob validation. Used after the orchestrator runs to gate uploads.
// The Tauri share path has no equivalent — the desktop import always
// inserts whatever XML it parses. The cloud uploader rejects games without
// a winner per spec §4 ("`match_metadata.winner` must exist").

import { ParseError } from "./extract-zip.js";
import { requireStr } from "./parse-xml.js";
import type { FullGameData } from "./types.js";

/**
 * Throws `ParseError("INCOMPLETE_GAME")` if the parsed game has no
 * detected winner. Returns void on success.
 */
export function validateCompletedGame(data: FullGameData): void {
	if (data.match_metadata.winner === null) {
		throw new ParseError(
			"Game has no winner — only completed games can be uploaded.",
			"INCOMPLETE_GAME",
		);
	}
}

/**
 * Pull the XML game id from the root without invoking the full
 * orchestrator. Useful for callers that want the id before deciding to do
 * the heavy parse (e.g., dedup check). Mirrors the `<Root GameId="...">`
 * attribute read in import.rs:217.
 */
export function extractGameId(root: Record<string, unknown>): string {
	return requireStr(root["@_GameId"], "Root.GameId");
}
