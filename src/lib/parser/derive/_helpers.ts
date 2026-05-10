// Shared helpers for derivation modules. Each module under derive/ ports
// one Rust query function from src-tauri/src/db/queries/ into a pure-fn
// over parsed entity arrays.

import type { Player } from "../parsers/players.js";

/**
 * Build a player_xml_id → Player map for fast lookups. Rust queries do this
 * via player_id JOINs against the players table; in TS we hash once.
 */
export function playerByXmlId(players: Player[]): Map<number, Player> {
	const m = new Map<number, Player>();
	for (const p of players) m.set(p.xmlId, p);
	return m;
}

/**
 * Sort players by `player_name`, mirroring `get_match_players`'s
 * `ORDER BY player_name` (mod.rs:31). Several history derivations iterate
 * players in this order; preserving it keeps the output equivalent to the
 * Rust share blob.
 */
export function playersOrderedByName(players: Player[]): Player[] {
	return [...players].sort((a, b) =>
		a.playerName.localeCompare(b.playerName, undefined, {
			sensitivity: "variant",
		}),
	);
}

/** Strip `<...>` markup tags. Mirrors DuckDB `regexp_replace(s, '<[^>]*>', '', 'g')`. */
export function stripMarkup(s: string): string {
	return s.replace(/<[^>]*>/g, "");
}

/**
 * Extract a `LAW_*` token from a description matching `HELP_LAW,LAW_X`.
 * Used by current-laws + law-adoption-history to recover the law name from
 * `LAW_ADOPTED` event log descriptions. Returns null if no match (matches
 * Rust's `regexp_extract` which yields empty string on no-match — we promote
 * that to null for simpler null-checks).
 */
const HELP_LAW_RE = /HELP_LAW,([A-Z_]+)/;
export function extractLawName(description: string): string | null {
	const m = HELP_LAW_RE.exec(description);
	return m ? m[1] : null;
}

/**
 * Stable string compare. JS's default Array.sort coerces to strings via
 * toString, which works for our case (we're already passing strings) but is
 * locale-dependent without explicit options. Use this for ORDER BY ports.
 */
export function strCmp(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
