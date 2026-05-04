// derive/game-religions.ts — port of get_game_religions (match_data.rs:254–273).
//
// Joins parsed Religion[] against players to resolve founder_nation. ORDER
// BY r.founded_turn NULLS LAST, r.religion_name.

import type { Player } from "../parsers/players.js";
import type { Religion } from "../parsers/religions.js";
import type { GameReligion } from "../types.js";
import { playerByXmlId, strCmp } from "./_helpers.js";

export function deriveGameReligions(
	religions: Religion[],
	players: Player[],
): GameReligion[] {
	const playerMap = playerByXmlId(players);

	const out: GameReligion[] = religions.map((r) => ({
		religion_name: r.religionName,
		founded_turn: r.foundedTurn,
		founder_nation:
			r.founderPlayerXmlId !== null
				? (playerMap.get(r.founderPlayerXmlId)?.nation ?? null)
				: null,
	}));

	// `NULLS LAST` on founded_turn — null entries sort after everything else.
	out.sort((a, b) => {
		const aT = a.founded_turn;
		const bT = b.founded_turn;
		if (aT === null && bT === null) {
			return strCmp(a.religion_name, b.religion_name);
		}
		if (aT === null) return 1;
		if (bT === null) return -1;
		return aT - bT || strCmp(a.religion_name, b.religion_name);
	});
	return out;
}
