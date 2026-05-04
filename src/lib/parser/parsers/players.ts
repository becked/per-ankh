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
	chosenHeirXmlId: number | null;
	originalCapitalCityXmlId: number | null;
	timeStockpile: number | null;
	techResearching: string | null;
	ambitionDelay: number;
	tilesPurchased: number;
	stateReligionChanges: number;
	tribeMercenariesHired: number;
}

export function parsePlayers(root: Record<string, unknown>): Player[] {
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
			// Pure-parser output; the save-owner detection pass overwrites this
			// downstream. Rust dump emits false here too.
			isSaveOwner: false,
			onlineId,
			email: optAttrStr(node["@_Email"]),
			aiControlledToTurn,
			difficulty: optAttrStr(node["@_Difficulty"]),
			lastTurnCompleted: optInt(node.LastTurnCompleted),
			// Rust bool::from_str accepts only "true"/"false" exactly.
			turnEnded: optStr(node.TurnEnded) === "true",
			legitimacy: optInt(node.Legitimacy),
			successionGender: optStr(node.SuccessionGender),
			stateReligion: optStr(node.StateReligion),
			founderCharacterXmlId: optInt(node.FounderCharacterID),
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

	return players;
}
