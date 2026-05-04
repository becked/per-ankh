// Tribe entity parser. Direct port of
// src-tauri/src/parser/parsers/tribes.rs.
//
// Tribes use string IDs (e.g. "TRIBE_REBELS"), not numeric XML IDs.

import { asArray, isElement, optInt, optStr, requireStr } from "../parse-xml.js";

export interface Tribe {
	tribeId: string;
	leaderCharacterXmlId: number | null;
	alliedPlayerXmlId: number | null;
	religion: string | null;
}

export function parseTribes(root: Record<string, unknown>): Tribe[] {
	const tribes: Tribe[] = [];

	for (const node of asArray(root.Tribe) as unknown[]) {
		if (!isElement(node)) continue;

		const tribeId = requireStr(node["@_ID"], "Tribe.ID");
		const leaderCharacterXmlId = optInt(node.LeaderID);

		// AlliedPlayer = -1 means "not allied"; player ID 0 is a valid ally.
		const alliedRaw = optInt(node.AlliedPlayer);
		const alliedPlayerXmlId =
			alliedRaw === null || alliedRaw < 0 ? null : alliedRaw;

		const religion = optStr(node.Religion);

		tribes.push({
			tribeId,
			leaderCharacterXmlId,
			alliedPlayerXmlId,
			religion,
		});
	}

	return tribes;
}

export function tribeToRow(t: Tribe): Record<string, unknown> {
	return {
		tribe_id: t.tribeId,
		leader_character_xml_id: t.leaderCharacterXmlId,
		allied_player_xml_id: t.alliedPlayerXmlId,
		religion: t.religion,
	};
}
