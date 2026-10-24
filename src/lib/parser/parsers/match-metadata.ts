// Match metadata parser. Returns a typed `MatchMetadata` struct — parse
// only, no persistence.
//
// The parser depends on already-parsed `Player[]` from `players.ts` so it
// can resolve a winning-team-id back to a player XML id without a second
// pass over the XML.

import { VICTORY_ORDERING } from "../../generated/victory-ordering.js";
import { ParseError } from "../extract-zip.js";
import {
	asArray,
	getElementChildren,
	isElement,
	optAttrStr,
	optInt,
	optStr,
	parseIndexList,
	parsePositionalList,
	requireStr,
} from "../parse-xml.js";
import type { MatchMetadata, RawWinnerInfo, WinnerInfo } from "../types.js";
import type { Player } from "./players.js";

export function parseMatchMetadata(
	root: Record<string, unknown>,
	players: Player[],
	entryName: string | null,
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
	// The attribute first, the file name whenever the attribute yields no
	// date: the attribute is what the game wrote, where a file name is
	// whatever it was last renamed to. Two cases reach the fallback, not one —
	// no attribute at all, and an attribute that won't parse, because
	// `Game.writeGameXML` (`Game.cs:1203`) writes
	// `DateTime.Now.ToString("dd MMMM yyyy")` under the client's culture and
	// MONTH_INDEX below holds English month names only.
	const saveDateAttr = optAttrStr(root["@_SaveDate"]);
	const saveDate =
		(saveDateAttr ? parseSaveDate(saveDateAttr) : null) ??
		parseEntryNameDate(entryName);

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

	const rawWinner = detectRawWinner(root, gameNode);
	const winner = rawWinner
		? resolveWinner(rawWinner, players, teamAssignments)
		: null;

	// `<Archetype>` is the one positional per-player list the game can write
	// SHORT: the archetype branch leaves `zArchetype` null when the trait index
	// is out of range and then writes no element at all
	// (`GameParameters.writeGameXML`, GameParameters.cs:736), where Difficulty,
	// Development, Nation and Dynasty each write unconditionally. A short list
	// shifts every later seat's archetype onto the wrong player, and nothing in
	// the file says where the gap was, so a list that doesn't carry one child
	// per player is dropped rather than misattributed. The branch is unreached
	// today — every sentinel archetype (TRAIT_RANDOM_ARCHETYPE,
	// TRAIT_PICK_LATER_ARCHETYPE, TRAIT_PRESET_ARCHETYPE) is a real `trait.xml`
	// row, and child count equals player count on all 16 saves in
	// `test-data/saves/`.
	const setupArchetypes = parsePositionalList(
		root.Archetype,
		"LeaderArchetype",
	);

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
		map_aspect_ratio: optAttrStr(root["@_MapAspectRatio"]),
		map_options: parseMapOptions(root),
		game_options: parseGameOptions(root),
		disabled_improvements: parseDisabledImprovements(gameNode),
		game_mode: optAttrStr(root["@_GameMode"]),
		// Difficulty is per-player in the save (`<Difficulty><PlayerDifficulty>`);
		// the match-level "Difficulty" stamp is the save owner's tier, set by
		// parsePlayers via the <?ActivePlayer N?> PI or the single-human fallback.
		// Returns null when no save owner could be identified (observer upload
		// of multi-human MP without the PI). Old World calls this setting
		// PROSPERITY — "Difficulty" is the preset that expands into it plus the
		// five AI/tribe/calamity knobs. The field keeps the save's own name.
		difficulty: players.find((p) => p.isSaveOwner)?.difficulty ?? null,
		setup_parameters: parseSetupParameters(root),
		occurrence_levels: parseOccurrenceLevels(root),
		// The setup side of the three per-player parameters whose resolved side
		// the save records separately: `<Player @Nation>` / `@Dynasty` hold what
		// the game rolled, and these hold what the player picked. 40 of the 48
		// player rows in `test-data/saves/` picked RANDOM or NONE and resolved to
		// a concrete nation, which is what makes the pair worth keeping.
		setup_nations: parsePositionalList(root.Nation, "PlayerNation"),
		setup_archetypes:
			setupArchetypes.length === players.length ? setupArchetypes : [],
		setup_dynasties: parsePositionalList(root.Dynasty, "PlayerDynasty"),
		// The setup's own human flags, which `<Humans>` writes as player
		// indices. The authoritative human count: the game decides a game is
		// multiplayer by counting this list (`iNumHumans > 1`, Game.cs:11957)
		// and answers per seat from it (`Game.isPlayerHumanOriginal`,
		// Game.cs:14575), where `players[].is_human` is our own heuristic over
		// `@OnlineID` / `@AIControlledToTurn`.
		setup_humans: parseIndexList(root.Humans, "PlayerHuman"),
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
 * Returns `[version_number, joined_mod_names]`.
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
 * Walk `<GameContent>` children for `DLC_*` element names.
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

// ---------- Map options ----------

/**
 * Read the chosen per-script map options the game persisted, as a flat
 * `zType → value` map, under the names `GameParameters.writeGameXML` actually
 * writes (GameParameters.cs:807 and :814; `readGameXML` reads the same at
 * :1148 / :1168):
 *
 *   <MapMultiOptions>
 *     <MAP_OPTIONS_MULTI_RESOURCE_DENSITY>MAP_OPTION_HIGH_RESOURCES</...>
 *   </MapMultiOptions>
 *   <MapSingleOptions>
 *     <MAP_OPTIONS_SINGLE_MIRROR>1</MAP_OPTIONS_SINGLE_MIRROR>
 *   </MapSingleOptions>
 *
 * This read was `<MapOptionsMulti>` / `<MapOptionsSingle>` — names the game
 * never writes — and compared the single values against "true", which they
 * never are. Both elements are present on every one of the 16 saves in
 * `test-data/saves/` under the names above and on none of them under the old
 * ones, so every stored blob below PARSER_VERSION 2.28.0 carries
 * `map_options = {}` and the Settings tab's Options row has never rendered.
 *
 * Multi values are MAP_OPTION_* zType strings. Single values are the ints
 * `p.Value.ToString()` writes — 14 `1` and 16 `0` across the corpus, never
 * "true"/"false" — so the test is the game's own `p.Value != 0`
 * (`buildMapOptions`, HelpText.Game.cs:3373).
 *
 * Map size + aspect ratio are root attributes, not options, so they never
 * appear here.
 */
function parseMapOptions(
	root: Record<string, unknown>,
): Record<string, string | boolean> {
	const out: Record<string, string | boolean> = {};

	const multi = root.MapMultiOptions;
	if (isElement(multi)) {
		for (const [opt, value] of getElementChildren(multi)) {
			if (typeof value === "string" && value !== "") out[opt] = value;
		}
	}

	const single = root.MapSingleOptions;
	if (isElement(single)) {
		for (const [opt, value] of getElementChildren(single)) {
			if (typeof value === "string" && value !== "") {
				out[opt] = Number(value) !== 0;
			}
		}
	}

	return out;
}

// ---------- Setup parameters ----------

/**
 * The root attributes `GameParameters.writeGameXML` (GameParameters.cs:536)
 * writes for a game's setup, in the order that method writes them.
 *
 * One list rather than eighteen hand-written reads, so a save that predates a
 * parameter simply yields a bag without that key. `MapClass`, `MapSize`,
 * `MapAspectRatio` and `GameMode` are deliberately absent: they already have
 * their own `MatchMetadata` fields, and a second way to read them is what the
 * bag exists to prevent.
 */
const SETUP_ATTRIBUTES: readonly string[] = [
	"Scenario",
	"TurnStyle",
	"TurnTimer",
	"OpponentLevel",
	"TribeLevel",
	"Development",
	"HumanDevelopment",
	"Advantage",
	"SuccessionGender",
	"SuccessionOrder",
	"Mortality",
	"TurnScale",
	"TeamNation",
	"ForceMarch",
	"EventLevel",
	"VictoryPointModifier",
	"SimultaneousTurns",
];

/**
 * Every setup parameter the save carries, keyed by the attribute name verbatim
 * — the shape `game_options` and `map_options` already use.
 *
 * Most attributes are written only when the setting is not NONE, and
 * `SimultaneousTurns` only when it is above zero, so an absent key means the
 * game did not set that parameter. An empty bag is a save that set none of
 * them; a blob with no bag at all (below PARSER_VERSION 2.28.0) is the
 * different claim that we do not know.
 */
function parseSetupParameters(
	root: Record<string, unknown>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const name of SETUP_ATTRIBUTES) {
		const value = optAttrStr(root[`@_${name}`]);
		if (value !== null && value !== "") out[name] = value;
	}
	return out;
}

/**
 * `<OccurrenceLevels>` as `occurrence class → level`:
 *
 *   <OccurrenceLevels>
 *     <OCCURRENCECLASS_CALAMITIES>OCCURRENCELEVEL_CALAMITIES_LOW</...>
 *   </OccurrenceLevels>
 *
 * Its own field rather than a `setup_parameters` entry because it is an
 * element with per-class children where the bag is flat scalars. 12 of the 16
 * saves in `test-data/saves/` carry a non-empty one; the game writes the
 * element either way, so an empty map is "no calamity setting", not "unknown".
 *
 * `GameParameters.GetDifficultyMode` (GameParameters.cs:1907) counts these as
 * part of the difficulty preset, which is why they belong beside the five
 * attributes above rather than with the event settings.
 */
function parseOccurrenceLevels(
	root: Record<string, unknown>,
): Record<string, string> {
	const out: Record<string, string> = {};
	const node = root.OccurrenceLevels;
	if (!isElement(node)) return out;
	for (const [cls, level] of getElementChildren(node)) {
		if (typeof level === "string" && level !== "") out[cls] = level;
	}
	return out;
}

// ---------- Game options ----------

/**
 * The game-wide option flags the player turned on, as a `zType → true` map:
 *
 *   <GameOptions>
 *     <GAMEOPTION_CUSTOM_LEADER />
 *     <GAMEOPTION_COMPETITIVE_MODE />
 *   </GameOptions>
 *
 * Presence is the value — the elements are empty — so an unset option is
 * simply absent, and a default game yields `{}`.
 *
 * IMPORTANT: this is the set of *parent* options only. Old World writes an
 * option to the save just when `meSubTypeOf == NONE` (GameParameters.cs:773),
 * and resolves a sub-option's state by recursing to its parent instead of
 * storing it (`IsGameOption`, same file :204). So a sub-option — e.g.
 * GAMEOPTION_LOWER_CHARACTER_YIELDS, the one carrying Competitive Mode's
 * character-yield effect — NEVER appears here, and a membership test for one
 * silently reads false. Test the parent (GAMEOPTION_COMPETITIVE_MODE) instead.
 */
function parseGameOptions(root: Record<string, unknown>): Record<string, true> {
	const out: Record<string, true> = {};

	const options = root.GameOptions;
	if (!isElement(options)) return out;

	for (const [name] of getElementChildren(options)) out[name] = true;
	return out;
}

// Improvements switched off for this game, as a sorted list of zTypes. Old
// World rolls a subset of the wonders into each game and disables the rest —
// a base-game save typically carries 15 disabled, leaving 13 buildable — so
// this is what separates "nobody built it" from "it wasn't in this game".
// Non-wonder improvements can appear here too; consumers filter by the
// baked wonder table.
//
// The block hangs off <Game>, not the root — reading it from the root found
// nothing on every save, and that failure is silent rather than loud, because
// consumers derive the pool by subtracting this list from the baked wonder
// table: an empty list reads as "every wonder was on the board".
//
// Three-way for that same reason. Absent → null: the save doesn't say, so
// there is no pool to derive. Present but empty → []: nothing was disabled.
// An empty element parses to "" rather than an object, so presence is the
// test, not isElement.
function parseDisabledImprovements(
	gameNode: Record<string, unknown>,
): string[] | null {
	const disabled = gameNode.ImprovementDisabled;
	if (disabled === undefined) return null;
	if (!isElement(disabled)) return [];
	return [...getElementChildren(disabled)].map(([name]) => name).sort();
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

// The `yyyy-MM-dd-HH-mm-ss` tail of a completed-save file name. The clock is
// matched but unused: it is what makes the tail specific enough that a game
// name ending in digits can't be mistaken for it.
const ENTRY_NAME_DATE_RE = /-(\d{4})-(\d{2})-(\d{2})-\d{2}-\d{2}-\d{2}\.xml$/i;

/**
 * Parse the save's write date out of the ZIP entry name, as ISO `YYYY-MM-DD`.
 * Returns null when the name carries no timestamp.
 *
 * This is the fallback for a save whose `SaveDate` attribute yields no date.
 * Old World did not always write the attribute, and a save from such a build
 * has no date anywhere in its XML, so every date surface renders "Unknown"
 * (#274).
 *
 * The name is the same instant, not a substitute for it.
 * `Game.getEndAutoSavePath` (`Game.cs:16348`) formats
 * `Constants.END_SAVE_FORMAT` — `OW-{0}-Year{turn}-{yyyy-MM-dd-HH-mm-ss}.zip`
 * — off the same `DateTime.Now` that `Game.writeGameXML` (`Game.cs:1203`)
 * formats into the attribute, and the ZIP carries that name on its XML entry.
 * Only the date is kept: the column holds date-only values and consumers
 * `substr(save_date, 1, 10)` it.
 *
 * Anchored on the tail rather than parsed from the prefix because the `{0}`
 * slot is arbitrary text, not the nation. It is `getSaveID` (`Game.cs:16335`)
 * — `{GameName}-{nation}` when the game has a name, the bare nation when it
 * doesn't, and the game name alone when the seat has no nation at all. The
 * game name reaches it with its invalid-filename characters *deleted* rather
 * than replaced, so a name holding a path collapses into the prefix
 * (`CUsersbeckeDocuments…OW-Assyria-Year136-2023-03-15-22-42-24.xml`), and
 * the nation is localized — `textManager().TEXT(nation().meName)`, which
 * test-data/saves/match_426504725_05-moroten-droner.zip carries as
 * `OW-Персия-Year59-2025-09-12-01-24-17.xml`.
 *
 * Checked against the calendar, which the attribute path has no need to be:
 * `DateTime.Now` can't produce February 30th and a renamed file can, and
 * `new Date` rolls an impossible ISO date over ("2022-02-30" → March 2nd)
 * rather than rejecting it — so the round-trip is the check, not NaN.
 *
 * Measured over test-data/saves/ — 16 saves, 14 completed, builds 1.0.62443
 * to 1.0.84658. All 16 carry the attribute, so the corpus exercises the
 * attribute path and not this one; 13 of the 16 entry names end in the tail
 * and all 13 agree with the attribute's date, with no contradictions. The
 * other 3 are named `<text>-Turn<n>.xml`, which none of Old World's own save
 * paths produces (`Constants.{QUICK,AUTO,END}_SAVE_FORMAT`) — this returns
 * null for them, and their attribute is what dates them.
 */
function parseEntryNameDate(entryName: string | null): string | null {
	if (entryName === null) return null;
	const m = ENTRY_NAME_DATE_RE.exec(entryName);
	if (!m) return null;
	const iso = `${m[1]}-${m[2]}-${m[3]}`;
	const asDate = new Date(`${iso}T00:00:00Z`);
	if (Number.isNaN(asDate.getTime())) return null;
	return asDate.toISOString().slice(0, 10) === iso ? iso : null;
}

// ---------- Victory conditions ----------

/**
 * Ordered list of *enabled* victory types from `<VictoryEnabled>`, joined into
 * the `victory_conditions` field. This is a per-save subset and is NOT a valid
 * index space for `<WinnerVictory>` — that field indexes the global victory
 * info-list (see `VICTORY_ORDERING`, baked from `victory.xml`), which keeps its
 * indices even when some types are disabled.
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
export function parseTeamAssignments(root: Record<string, unknown>): number[] {
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
 *      index into the *global* victory info-list (`VICTORY_ORDERING`, baked
 *      from `victory.xml`), NOT the per-save `<VictoryEnabled>` subset — the
 *      global list keeps its indices even when some victory types are disabled.
 *   3. `<Victory winner="player_xml_id" type="...">` at the root — older
 *      single-player fallback shape (rarely seen in modern saves).
 * Returns the team-id form for (1)/(2) and the player-id form for (3). The
 * resolver below maps either back to a player.
 */
function detectRawWinner(
	root: Record<string, unknown>,
	gameNode: Record<string, unknown>,
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
		// Index the global victory ordering, not the enabled subset: disabling an
		// earlier victory type compresses <VictoryEnabled> and shifts indices, so
		// indexing it drops the winner (e.g. CONQUEST at global idx 4 with
		// DOUBLE+AMBITION disabled lands past the end of a 3-entry enabled list).
		const victoryType = VICTORY_ORDERING[winnerVictoryIdx];
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
	// exactly one human exists; otherwise we'd guess.
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
