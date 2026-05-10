// derive/city-statistics.ts — port of get_city_statistics (map.rs:231–288).
//
// Projects parsed City[] with resolved owner nation, governor name, family
// class, and culture level. Culture level is looked up by team_id from
// city_culture; team_id falls back to player.xmlId per the Rust COALESCE.

import type { Character } from "../parsers/characters.js";
import type { City, CityCulture } from "../parsers/cities.js";
import type { Family } from "../parsers/families.js";
import type { Player } from "../parsers/players.js";
import type { CityInfo, CityStatistics } from "../types.js";
import { playerByXmlId, strCmp } from "./_helpers.js";

export function deriveCityStatistics(
	cities: City[],
	cityCulture: CityCulture[],
	families: Family[],
	characters: Character[],
	players: Player[],
): CityStatistics {
	const playerMap = playerByXmlId(players);
	const characterMap = new Map<number, Character>();
	for (const c of characters) characterMap.set(c.xmlId, c);

	// Family lookup is by name, scoped to the player who owns the family.
	const familyByName = new Map<string, Family>();
	for (const f of families) {
		// Two players could theoretically share a family name; the SQL only
		// joins on family_name, not player. First write wins.
		if (!familyByName.has(f.familyName)) familyByName.set(f.familyName, f);
	}

	// city_culture indexed by (city_xml_id, team_id).
	const cultureKey = (city: number, team: number) => `${city}:${team}`;
	const cultureByKey = new Map<string, CityCulture>();
	for (const cc of cityCulture) {
		cultureByKey.set(cultureKey(cc.cityXmlId, cc.teamId), cc);
	}

	const out: CityInfo[] = cities.map((c) => {
		const owner =
			c.playerXmlId !== null ? playerMap.get(c.playerXmlId) : undefined;
		// COALESCE(team_id, xml_id) — players' team_id is a string attribute
		// in the parser; coerce to int and fall back to xml_id when null/NaN.
		// When the city has no player owner at all, the Rust JOIN doesn't
		// match (NULL = NULL is false in SQL) so culture_level lands NULL.
		// Mirror that here by skipping the lookup when owner is undefined.
		let teamForCulture: number | null = null;
		if (owner !== undefined) {
			teamForCulture = c.playerXmlId ?? 0;
			if (owner.teamId !== null) {
				const parsed = parseInt(owner.teamId, 10);
				if (!Number.isNaN(parsed)) teamForCulture = parsed;
			}
		}

		const culture =
			teamForCulture !== null
				? cultureByKey.get(cultureKey(c.xmlId, teamForCulture))
				: undefined;
		const governor =
			c.governorXmlId !== null ? characterMap.get(c.governorXmlId) : undefined;
		const family = c.family !== null ? familyByName.get(c.family) : undefined;

		return {
			city_id: c.xmlId,
			city_name: c.cityName,
			owner_nation: owner?.nation ?? null,
			family: c.family,
			family_class: family?.familyClass ?? null,
			first_owner_player_xml_id: c.firstOwnerPlayerXmlId,
			founded_turn: c.foundedTurn,
			is_capital: c.isCapital,
			citizens: c.citizens,
			governor_name: governor?.firstName ?? null,
			culture_level: culture?.cultureLevel ?? null,
			growth_count: c.growthCount,
			unit_production_count: c.unitProductionCount,
			specialist_count: c.specialistCount,
			buy_tile_count: c.buyTileCount,
			hurry_civics_count: c.hurryCivicsCount,
			hurry_money_count: c.hurryMoneyCount,
			hurry_training_count: c.hurryTrainingCount,
			hurry_population_count: c.hurryPopulationCount,
		};
	});

	out.sort((a, b) => strCmp(a.city_name, b.city_name));
	return { cities: out };
}
