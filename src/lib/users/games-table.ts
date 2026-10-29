import type { GameListItem, GameListPlayer } from "$lib/api-cloud";
import { seatLabel } from "$lib/utils/formatting";

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

// The roster entry `gameSelfIndex` names, or null when the row carries no
// roster. The Game cell labels this seat the way it labels an opponent —
// crest, avatar, `seatLabel` — so that an observer upload, whose self seat is
// the first human rather than the uploader, doesn't name one side by nation
// and the other by person.
export function gameSelfSeat(game: GameListItem): GameListPlayer | null {
	const self = gameSelfIndex(game);
	if (self === null) return null;
	return game.players?.find((p) => p.player_index === self) ?? null;
}

// Everyone else on the roster, in player order — humans and AI alike, which
// is what makes this "who the game was against" rather than "the other
// humans": 38 of the 116 saves in test-data/saves/ have at most one human
// seat, and their opponents are AI nations.
export function gameOpponents(game: GameListItem): GameListPlayer[] {
	const self = gameSelfIndex(game);
	return (game.players ?? []).filter((p) => p.player_index !== self);
}

// How much opponent text a row spells out before the rest collapse into an
// ellipsis. A character budget rather than a seat count, because the two
// shapes that overrun the cell are not the same shape: a duel against one
// 18-character handle and a five-nation game against four short AI names both
// end up near the same width, and a count cap cuts only the second.
//
// 40 keeps every 1-, 2- and 3-opponent row whole across the 1,095 games in the
// 2026-10-23 D1 snapshot (their longest lists are 18, 19 and 36 characters)
// and most 4-opponent ones (average 34, longest 51). It bites on the tail
// above that, where the longest list is 84 characters and the game page is one
// click away.
const OPPONENT_LABEL_BUDGET = 40;

// What the " · " between two opponents costs against the budget.
const OPPONENT_SEPARATOR_COST = 3;

// The opponents a row spells out, and whether it left any unnamed.
//
// The first opponent is always named, however long its label: one opponent is
// the whole matchup, and a row that collapsed it to an ellipsis would say
// nothing at all. Its label truncates in CSS instead.
export function visibleOpponents(opponents: GameListPlayer[]): {
	shown: GameListPlayer[];
	truncated: boolean;
} {
	const shown: GameListPlayer[] = [];
	let used = 0;
	for (const opponent of opponents) {
		const cost =
			seatLabel(opponent).length +
			(shown.length > 0 ? OPPONENT_SEPARATOR_COST : 0);
		if (shown.length > 0 && used + cost > OPPONENT_LABEL_BUDGET) break;
		shown.push(opponent);
		used += cost;
	}
	return { shown, truncated: shown.length < opponents.length };
}
