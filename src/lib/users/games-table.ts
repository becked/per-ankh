import type { GameListItem, GameListPlayer } from "$lib/api-cloud";

// The profile Games table's column model and the two questions its cells ask
// of a row: which seat is the profile owner's, and who the game was against.
//
// Split out of GamesTable.svelte the way matches-table.ts is split out of
// MatchTable.svelte — the component owns the cell markup, this owns the
// column list and the row reads.

// ─── Columns ─────────────────────────────────────────────────────────

export interface GamesColumn {
	key: string;
	label: string;
	// The server sort this column's header toggles, as the `sort` query
	// param's base (`date`, `turns`, `name`, `result` — GAME_LIST_ORDER in
	// cloud/src/games.ts pairs each with `_asc`/`_desc`). Null for a column
	// the list query can't order by, whose header is inert.
	sort: string | null;
	// Which direction a first click picks. Newest-first and most-turns-first
	// are what a library reads by; alphabetical runs A–Z.
	firstDirection: "asc" | "desc";
}

// In render order. Every column but Game is one value; Game carries the
// matchup and, beneath it, the save's own name and its map.
export const GAMES_COLUMNS: readonly GamesColumn[] = [
	{ key: "game", label: "Game", sort: "name", firstDirection: "asc" },
	{ key: "turns", label: "Turns", sort: "turns", firstDirection: "desc" },
	{ key: "result", label: "Result", sort: "result", firstDirection: "desc" },
	{ key: "played", label: "Played", sort: "date", firstDirection: "desc" },
];

export interface GameSortState {
	base: string;
	direction: "asc" | "desc";
}

// Split a `sort` param into the column it names and its direction. An
// unrecognized or absent value reads as the server's own default
// (`date_desc`), so the header arrow and the list agree on a junk URL.
export function parseGameSort(sort: string | null | undefined): GameSortState {
	const [base, dir] = (sort ?? "").split("_");
	if (!base || (dir !== "asc" && dir !== "desc")) {
		return { base: "date", direction: "desc" };
	}
	return { base, direction: dir };
}

// Header click → the next `sort` param: flip direction on the active column,
// else switch to the clicked one in its own first direction. Mirrors
// toggleMatchSort, which flips in place and starts fresh columns ascending —
// the difference being that a game column declares its own first direction.
export function nextGameSort(
	current: string | null | undefined,
	column: GamesColumn,
): string | null {
	if (column.sort === null) return null;
	const { base, direction } = parseGameSort(current);
	if (base === column.sort) {
		return `${column.sort}_${direction === "asc" ? "desc" : "asc"}`;
	}
	return `${column.sort}_${column.firstDirection}`;
}

// ─── The two seats of a row ──────────────────────────────────────────

// The seat the row's own nation names: the one the uploader claimed, falling
// back to the first human in player order — the same fallback the list
// query's COALESCE(user_nation, …) applies to an observer-mode upload, so the
// cell's "you" and its nation can't disagree. Null when the row carries no
// roster (`?players=1` not asked for, or a game with no seat rows).
function gameSelfIndex(game: GameListItem): number | null {
	if (game.uploader_player_index != null) return game.uploader_player_index;
	return game.players?.find((p) => p.is_human)?.player_index ?? null;
}

// Everyone else on the roster, in player order — humans and AI alike, which
// is what makes this "who the game was against" rather than "the other
// humans": 38 of the 116 saves in test-data/saves/ have at most one human
// seat, and their opponents are AI nations.
export function gameOpponents(game: GameListItem): GameListPlayer[] {
	const self = gameSelfIndex(game);
	return (game.players ?? []).filter((p) => p.player_index !== self);
}

// How many opponents a row names before the rest collapse into "+N". Three
// covers 95 of the 116 saves in test-data/saves/ outright (75 have exactly
// one opponent, 6 have two, 14 have three); the cap bites on the FFA tail,
// where the longest roster is nine seats and the game page is one click away.
export const MAX_OPPONENTS_SHOWN = 3;
