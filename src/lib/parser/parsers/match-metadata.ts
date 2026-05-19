// Match metadata parser. Pure-parse port of
// `insert_match_metadata` (src-tauri/src/parser/import.rs:1134–1282) +
// `update_winner` (same file lines 956–1008) — the DB-write paths are
// dropped; this module returns a typed `MatchMetadata` struct.
//
// The parser depends on already-parsed `Player[]` from `players.ts` so it
// can resolve a winning-team-id back to a player XML id without a second
// pass over the XML.

import { ParseError } from "../extract-zip.js";
import {
	asArray,
	getElementChildren,
	isElement,
	optAttrStr,
	optInt,
	optStr,
	requireStr,
} from "../parse-xml.js";
import type { MatchMetadata, RawWinnerInfo, WinnerInfo } from "../types.js";
import type { Player } from "./players.js";

export function parseMatchMetadata(
	root: Record<string, unknown>,
	players: Player[],
): MatchMetadata {
	const xmlGameId = requireStr(root["@_GameId"], "Root.GameId");

	const gameNode = root.Game;
	if (!isElement(gameNode)) {
		throw new ParseError("Game", "MISSING_FIELD");
	}
	const totalTurns = optInt(gameNode.Turn);
	if (totalTurns === null) {
		throw new ParseError("Game.Turn", "MISSING_FIELD");
	}

	const versionAttr = optAttrStr(root["@_Version"]);
	const [gameVersion, enabledMods] = versionAttr
		? parseVersionString(versionAttr)
		: [null, null];

	const enabledDlc = parseGameContent(root);
	const saveDateAttr = optAttrStr(root["@_SaveDate"]);
	const saveDate = saveDateAttr ? parseSaveDate(saveDateAttr) : null;

	const mapWidth = optInt(root["@_MapWidth"]);
	// MapHeight is not encoded in the XML; the Rust parser assumes a square
	// map and reuses MapWidth. Keep the same convention.
	const mapHeight = mapWidth;

	const gameName = optAttrStr(root["@_GameName"]) ?? optStr(root.GameName);

	const victoryEnabled = parseVictoryEnabledList(root);
	const victoryConditions =
		victoryEnabled.length > 0 ? victoryEnabled.join("+") : null;
	const teamAssignments = parseTeamAssignments(root);

	const gameOver = "GameOver" in gameNode;

	const rawWinner = detectRawWinner(root, gameNode, victoryEnabled);
	const winner = rawWinner
		? resolveWinner(rawWinner, players, teamAssignments)
		: null;

	return {
		xml_game_id: xmlGameId,
		total_turns: totalTurns,
		game_name: gameName,
		save_date: saveDate,
		game_version: gameVersion,
		map_width: mapWidth,
		map_height: mapHeight,
		map_size: optAttrStr(root["@_MapSize"]),
		map_class: optAttrStr(root["@_MapClass"]),
		game_mode: optAttrStr(root["@_GameMode"]),
		// Difficulty is per-player in the save (`<Difficulty><PlayerDifficulty>`);
		// the match-level "Difficulty" stamp is the save owner's tier, set by
		// parsePlayers via the <?ActivePlayer N?> PI or the single-human fallback.
		// Returns null when no save owner could be identified (observer upload
		// of multi-human MP without the PI).
		difficulty: players.find((p) => p.isSaveOwner)?.difficulty ?? null,
		opponent_level: optAttrStr(root["@_OpponentLevel"]),
		victory_conditions: victoryConditions,
		enabled_mods: enabledMods,
		enabled_dlc: enabledDlc,
		game_over: gameOver,
		winner,
	};
}

// ---------- Version + mods ----------

/**
 * Parse the `Version` attribute. Format:
 *   `Version: 1.0.70671+MOD_NAME=hash+MOD_NAME2=hash`
 * Returns `[version_number, joined_mod_names]`. Mirrors
 * `parse_version_string` in import.rs:889–913.
 */
function parseVersionString(version: string): [string | null, string | null] {
	const parts = version.split("+");
	if (parts.length === 0) return [null, null];

	const versionNum = parts[0].startsWith("Version: ")
		? parts[0].slice("Version: ".length)
		: null;

	if (parts.length === 1) return [versionNum, null];

	// Each mod entry is "MOD_NAME=hash" — drop the hash.
	const modNames = parts.slice(1).map((s) => s.split("=")[0]);
	return [versionNum, modNames.join("+")];
}

// ---------- DLC content ----------

/**
 * Walk `<GameContent>` children for `DLC_*` element names. Mirrors
 * `parse_game_content` in import.rs:918–933.
 */
function parseGameContent(root: Record<string, unknown>): string | null {
	const gameContent = root.GameContent;
	if (!isElement(gameContent)) return null;

	const dlcs: string[] = [];
	for (const [name] of getElementChildren(gameContent)) {
		if (name.startsWith("DLC_")) dlcs.push(name);
	}
	return dlcs.length > 0 ? dlcs.join("+") : null;
}

// ---------- Save date ----------

const SAVE_DATE_RE = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/;
const MONTH_INDEX: Record<string, number> = {
	January: 1,
	February: 2,
	March: 3,
	April: 4,
	May: 5,
	June: 6,
	July: 7,
	August: 8,
	September: 9,
	October: 10,
	November: 11,
	December: 12,
};

/**
 * Parse "31 January 2024"-style strings to ISO `YYYY-MM-DD`. Returns null
 * for unparseable input — same lenient behavior as Rust's `chrono::NaiveDate
 * ::parse_from_str(...).ok()`.
 */
function parseSaveDate(dateStr: string): string | null {
	const m = SAVE_DATE_RE.exec(dateStr.trim());
	if (!m) return null;
	const day = parseInt(m[1], 10);
	const month = MONTH_INDEX[m[2]];
	const year = parseInt(m[3], 10);
	if (Number.isNaN(day) || month === undefined || Number.isNaN(year)) {
		return null;
	}
	const dayPad = day.toString().padStart(2, "0");
	const monthPad = month.toString().padStart(2, "0");
	return `${year}-${monthPad}-${dayPad}`;
}

// ---------- Victory conditions ----------

/**
 * Ordered list of enabled victory types from `<VictoryEnabled>`. Two consumers:
 *   1. `victory_conditions` field — joined with `+` for compact storage.
 *   2. Mapping a `<WinnerVictory>` integer to a `VICTORY_*` string for the
 *      legacy winner format (older save versions). The integer is a runtime
 *      info-list index; this list is the per-save snapshot of that order.
 */
function parseVictoryEnabledList(root: Record<string, unknown>): string[] {
	const ve = root.VictoryEnabled;
	if (!isElement(ve)) return [];

	const names: string[] = [];
	for (const [name] of getElementChildren(ve)) names.push(name);
	return names;
}

// ---------- Team assignments ----------

/**
 * `<Team><PlayerTeam>0</PlayerTeam><PlayerTeam>1</PlayerTeam></Team>` —
 * the index of each `PlayerTeam` corresponds to the player XML id and its
 * text is that player's team id. Returns the array indexed by player XML id.
 */
function parseTeamAssignments(root: Record<string, unknown>): number[] {
	const teamElem = root.Team;
	if (!isElement(teamElem)) return [];

	const out: number[] = [];
	for (const child of asArray(teamElem.PlayerTeam) as unknown[]) {
		// Children may be primitive strings (text-only) or element objects.
		// fast-xml-parser only wraps when ALWAYS_ARRAY_TAGS includes the name;
		// PlayerTeam is in the list, so we always get an array.
		const text = typeof child === "string" ? child : null;
		if (text === null) continue;
		const teamId = parseInt(text, 10);
		if (Number.isNaN(teamId)) continue;
		out.push(teamId);
	}
	return out;
}

// ---------- Winner detection ----------

/**
 * Pull a raw winner from XML. Three sources, in priority order:
 *   1. `<Game><TeamVictories><Team Victory="...">winning_team_id</Team></TeamVictories>`
 *      — newer save format (≥ ~1.0.79513).
 *   2. `<Game><WinnerTeam>N</WinnerTeam><WinnerVictory>N</WinnerVictory>`
 *      — legacy save format (≤ ~1.0.70671). `WinnerVictory` is an integer
 *      index into the per-save `<VictoryEnabled>` list, passed in here.
 *   3. `<Victory winner="player_xml_id" type="...">` at the root — older
 *      single-player fallback shape (rarely seen in modern saves).
 * Returns the team-id form for (1)/(2) and the player-id form for (3). The
 * resolver below maps either back to a player.
 */
function detectRawWinner(
	root: Record<string, unknown>,
	gameNode: Record<string, unknown>,
	victoryEnabled: string[],
): RawWinnerInfo | { player_xml_id: number; victory_type: string } | null {
	const teamVictories = gameNode.TeamVictories;
	if (isElement(teamVictories)) {
		// `<TeamVictories>` may contain multiple `<Team>` children when more
		// than one team has met victory criteria simultaneously. Mirrors
		// Rust's `tv.children().find(|n| n.has_tag_name("Team"))` — first
		// match wins. Note: "Team" is not in ALWAYS_ARRAY_TAGS, so a single
		// child arrives as an object and multiple as an array; asArray
		// normalizes both shapes.
		const teamEntries = asArray(teamVictories.Team) as unknown[];
		for (const teamEntry of teamEntries) {
			if (!isElement(teamEntry)) continue;
			const teamIdRaw = optInt(teamEntry["#text"]);
			const victoryType = optAttrStr(teamEntry["@_Victory"]);
			if (teamIdRaw !== null && victoryType !== null) {
				return { team_id: teamIdRaw, victory_type: victoryType };
			}
		}
	}

	// Legacy format: <WinnerTeam>int</WinnerTeam> + <WinnerVictory>int</WinnerVictory>.
	// Both elements are present on completed games in older versions and absent
	// in newer versions — checking both ensures we don't misread a default-zero
	// integer when only one is set.
	const winnerTeamId = optInt(gameNode.WinnerTeam);
	const winnerVictoryIdx = optInt(gameNode.WinnerVictory);
	if (winnerTeamId !== null && winnerVictoryIdx !== null) {
		const victoryType = victoryEnabled[winnerVictoryIdx];
		if (victoryType !== undefined) {
			return { team_id: winnerTeamId, victory_type: victoryType };
		}
	}

	const victoryRoot = root.Victory;
	if (isElement(victoryRoot)) {
		const winnerId = optInt(victoryRoot["@_winner"]);
		const victoryType = optAttrStr(victoryRoot["@_type"]);
		if (winnerId !== null && victoryType !== null) {
			return { player_xml_id: winnerId, victory_type: victoryType };
		}
	}

	return null;
}

/**
 * Resolve a raw winner record into a `WinnerInfo` with a concrete player
 * XML id. Three strategies, in order (combines insert_match_metadata's
 * team_assignments lookup with update_winner's two fallbacks):
 *   1. team_assignments[player_xml_id] === team_id (Team/PlayerTeam mapping)
 *   2. players[i].teamId === team_id_str (Player @Team attribute)
 *   3. the single human player (single-player save fallback)
 *
 * If the raw winner already carries a player_xml_id (Victory-element form),
 * returns it as-is.
 */
function resolveWinner(
	raw: RawWinnerInfo | { player_xml_id: number; victory_type: string },
	players: Player[],
	teamAssignments: number[],
): WinnerInfo | null {
	if ("player_xml_id" in raw) {
		return {
			winner_player_xml_id: raw.player_xml_id,
			winner_team_id: null,
			victory_type: raw.victory_type,
		};
	}

	const teamId = raw.team_id;
	if (teamId === null) return null;

	// Strategy 1: Team/PlayerTeam mapping.
	const idxByTeam = teamAssignments.indexOf(teamId);
	if (idxByTeam !== -1) {
		return {
			winner_player_xml_id: idxByTeam,
			winner_team_id: teamId,
			victory_type: raw.victory_type,
		};
	}

	// Strategy 2: Player @Team attribute.
	const teamIdStr = teamId.toString();
	const byAttr = players.find((p) => p.teamId === teamIdStr);
	if (byAttr) {
		return {
			winner_player_xml_id: byAttr.xmlId,
			winner_team_id: teamId,
			victory_type: raw.victory_type,
		};
	}

	// Strategy 3: SP fallback — the single human player. Only safe when
	// exactly one human exists; otherwise we'd guess. Mirrors update_winner's
	// "find the human player" path at import.rs:976.
	const humans = players.filter((p) => p.isHuman);
	if (humans.length === 1) {
		return {
			winner_player_xml_id: humans[0].xmlId,
			winner_team_id: teamId,
			victory_type: raw.victory_type,
		};
	}

	// No resolution — surface a parse error rather than silently dropping a
	// winner detection. The caller can downgrade this to `winner: null` if
	// the policy is "incomplete game" rather than "broken save".
	throw new ParseError(
		`Could not resolve winning team ${teamId} to a player`,
		"INVALID_FORMAT",
	);
}
