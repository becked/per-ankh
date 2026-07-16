// Player entity parser. Direct port of
// src-tauri/src/parser/parsers/players.rs.

import {
	asArray,
	isElement,
	optAttrStr,
	optInt,
	optStr,
	requireInt,
	requireStr,
} from "../parse-xml.js";

export interface Player {
	xmlId: number;
	playerName: string;
	nation: string | null;
	dynasty: string | null;
	teamId: string | null;
	isHuman: boolean;
	isSaveOwner: boolean;
	onlineId: string | null;
	email: string | null;
	aiControlledToTurn: number | null;
	difficulty: string | null;
	lastTurnCompleted: number | null;
	turnEnded: boolean;
	legitimacy: number | null;
	successionGender: string | null;
	stateReligion: string | null;
	founderCharacterXmlId: number | null;
	// The player's CURRENT leader — the last id in <Leaders>, which is a
	// succession list in reign order. Matches Player.leader()
	// (Player.cs:11496 → `game().character(getLeaders().Last())`); null when
	// the player has never had a leader.
	leaderCharacterXmlId: number | null;
	chosenHeirXmlId: number | null;
	originalCapitalCityXmlId: number | null;
	timeStockpile: number | null;
	techResearching: string | null;
	ambitionDelay: number;
	tilesPurchased: number;
	stateReligionChanges: number;
	tribeMercenariesHired: number;
}

export function parsePlayers(
	root: Record<string, unknown>,
	activePlayerIndex: number | null,
): Player[] {
	const playerDifficulties = parsePlayerDifficulties(root);
	const players: Player[] = [];

	for (const node of asArray(root.Player) as unknown[]) {
		if (!isElement(node)) continue;

		const xmlId = requireInt(node["@_ID"], "Player.ID");
		const playerName = requireStr(node["@_Name"], "Player.Name");
		const onlineId = optAttrStr(node["@_OnlineID"]);
		const aiControlledToTurn = optInt(node["@_AIControlledToTurn"]);

		// is_human: OnlineID is the load-bearing check. In multiplayer, only
		// the active player has AIControlledToTurn=0; every other human player
		// has AIControlledToTurn>0 because they're not the active player.
		// Without the OnlineID branch they'd be misflagged as AI. (See
		// cloud-rewrite-spec §328 and players.rs:46–54.)
		const hasOnlineId = onlineId !== null && onlineId !== "";
		const isHuman = hasOnlineId || aiControlledToTurn === 0;

		players.push({
			xmlId,
			playerName,
			nation: optAttrStr(node["@_Nation"]),
			dynasty: optAttrStr(node["@_Dynasty"]),
			teamId: optAttrStr(node["@_Team"]),
			isHuman,
			isSaveOwner: false,
			onlineId,
			email: optAttrStr(node["@_Email"]),
			aiControlledToTurn,
			difficulty: playerDifficulties[xmlId] ?? null,
			lastTurnCompleted: optInt(node.LastTurnCompleted),
			// Rust bool::from_str accepts only "true"/"false" exactly.
			turnEnded: optStr(node.TurnEnded) === "true",
			legitimacy: optInt(node.Legitimacy),
			successionGender: optStr(node.SuccessionGender),
			stateReligion: optStr(node.StateReligion),
			founderCharacterXmlId: optInt(node.FounderCharacterID),
			leaderCharacterXmlId: parseCurrentLeader(node),
			chosenHeirXmlId: optInt(node.ChosenHeirID),
			originalCapitalCityXmlId: optInt(node.OriginalCapitalCityID),
			timeStockpile: optInt(node.TimeStockpile),
			techResearching: optStr(node.TechResearching),
			ambitionDelay: optInt(node.AmbitionDelay) ?? 0,
			tilesPurchased: optInt(node.TilesPurchased) ?? 0,
			stateReligionChanges: optInt(node.StateReligionChanges) ?? 0,
			tribeMercenariesHired: optInt(node.TribeMercenariesHired) ?? 0,
		});
	}

	resolveSaveOwner(players, activePlayerIndex);
	return players;
}

/**
 * The player's current leader, from their `<Leaders><ID>…</ID></Leaders>`
 * succession list:
 *
 *   <Leaders><ID>6</ID><ID>75</ID><ID>166</ID></Leaders>
 *
 * The list is in reign order and the LAST entry is the reigning leader —
 * matching `Player.leader()` (Player.cs:11496), which is literally
 * `game().character(getLeaders().Last())`. Deliberately reads the game's own
 * ordering rather than re-deriving it by sorting characters on
 * `became_leader_turn`, which would have to guess at ties and abdications.
 *
 * Returns null for a player who has never had a leader (the element is
 * written empty). `<ID>` is a leaf, so a single-leader player yields a bare
 * string and a multi-leader player an array; asArray normalizes both.
 */
function parseCurrentLeader(node: Record<string, unknown>): number | null {
	const leaders = node.Leaders;
	if (!isElement(leaders)) return null;

	const ids = asArray(leaders.ID) as unknown[];
	const last = ids[ids.length - 1];
	if (typeof last !== "string") return null;

	const id = parseInt(last, 10);
	return Number.isNaN(id) ? null : id;
}

/**
 * Pull per-player difficulty tiers from `<Difficulty><PlayerDifficulty>…
 * </PlayerDifficulty>…</Difficulty>`. The returned array is positional —
 * `result[playerXmlId]` is that player's tier (or `null` if the element is
 * missing or malformed). The `<PlayerDifficulty>` element is NOT in
 * ALWAYS_ARRAY_TAGS, so fast-xml-parser already coerces multiple siblings
 * to an array of text-only strings; asArray normalizes the single-child case.
 */
function parsePlayerDifficulties(
	root: Record<string, unknown>,
): (string | null)[] {
	const difficultyElem = root.Difficulty;
	if (!isElement(difficultyElem)) return [];
	const out: (string | null)[] = [];
	for (const child of asArray(difficultyElem.PlayerDifficulty) as unknown[]) {
		out.push(typeof child === "string" && child !== "" ? child : null);
	}
	return out;
}

/**
 * Identify which player owns the save and set `isSaveOwner = true` on
 * exactly one (or none). Resolution order:
 *   1. `<?ActivePlayer N?>` PI value (when present) — N is the player_index
 *      of whoever's perspective the file was saved from.
 *   2. Single human in the roster — natural fallback for SP saves and any
 *      MP save where exactly one human exists.
 *   3. Neither — observer upload of multi-human MP without the PI. No
 *      save owner is identified; the headline difficulty falls back to null.
 */
function resolveSaveOwner(
	players: Player[],
	activePlayerIndex: number | null,
): void {
	if (activePlayerIndex !== null) {
		const owner = players.find((p) => p.xmlId === activePlayerIndex);
		if (owner) {
			owner.isSaveOwner = true;
			return;
		}
	}
	const humans = players.filter((p) => p.isHuman);
	if (humans.length === 1) {
		humans[0].isSaveOwner = true;
	}
}

export function playerToRow(p: Player): Record<string, unknown> {
	return {
		xml_id: p.xmlId,
		player_name: p.playerName,
		nation: p.nation,
		dynasty: p.dynasty,
		team_id: p.teamId,
		is_human: p.isHuman,
		is_save_owner: p.isSaveOwner,
		online_id: p.onlineId,
		email: p.email,
		ai_controlled_to_turn: p.aiControlledToTurn,
		difficulty: p.difficulty,
		last_turn_completed: p.lastTurnCompleted,
		turn_ended: p.turnEnded,
		legitimacy: p.legitimacy,
		succession_gender: p.successionGender,
		state_religion: p.stateReligion,
		founder_character_xml_id: p.founderCharacterXmlId,
		leader_character_xml_id: p.leaderCharacterXmlId,
		chosen_heir_xml_id: p.chosenHeirXmlId,
		original_capital_city_xml_id: p.originalCapitalCityXmlId,
		time_stockpile: p.timeStockpile,
		tech_researching: p.techResearching,
		ambition_delay: p.ambitionDelay,
		tiles_purchased: p.tilesPurchased,
		state_religion_changes: p.stateReligionChanges,
		tribe_mercenaries_hired: p.tribeMercenariesHired,
	};
}
