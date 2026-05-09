// Cloud-blob validation. Used after the orchestrator runs to gate uploads.
// The Tauri share path has no equivalent — the desktop import always
// inserts whatever XML it parses. The cloud uploader rejects games without
// a winner per spec §4 ("`match_metadata.winner` must exist").

import { ParseError } from "./extract-zip.js";
import { requireStr } from "./parse-xml.js";
import type { FullGameData } from "./types.js";

/**
 * Single completion gate: reject saves without `<Game><GameOver/>`. A null
 * `winner` is allowed — pre-1.0.62443 saves end with `<GameOver/>` but
 * record no winner XML at all (the game's runtime decided the outcome and
 * never persisted it). Those games surface as "Ended" in the UI rather
 * than failing import.
 */
export function validateCompletedGame(data: FullGameData): void {
	if (!data.match_metadata.game_over) {
		throw new ParseError(
			"Save is not a completed game — only completed games can be uploaded.",
			"NOT_COMPLETED",
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
