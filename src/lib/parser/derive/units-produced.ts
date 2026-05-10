// derive/units-produced.ts — port of get_units_produced (map.rs:323–353).
//
// Direct projection over PlayerUnitProduction with player_name/nation
// resolved. ORDER BY p.nation, u.count DESC, u.unit_type.

import type { Player } from "../parsers/players.js";
import type { PlayerUnitProduction } from "../parsers/units.js";
import type { PlayerUnitProduced } from "../types.js";
import { playerByXmlId, strCmp } from "./_helpers.js";

export function deriveUnitsProduced(
	playerUnitsProduced: PlayerUnitProduction[],
	players: Player[],
): PlayerUnitProduced[] {
	const playerMap = playerByXmlId(players);
	const out: PlayerUnitProduced[] = [];

	for (const u of playerUnitsProduced) {
		const player = playerMap.get(u.playerXmlId);
		if (!player) continue;
		out.push({
			player_id: u.playerXmlId,
			player_name: player.playerName,
			nation: player.nation,
			unit_type: u.unitType,
			count: u.count,
		});
	}

	out.sort(
		(a, b) =>
			strCmp(a.nation ?? "", b.nation ?? "") ||
			b.count - a.count ||
			strCmp(a.unit_type, b.unit_type),
	);
	return out;
}
