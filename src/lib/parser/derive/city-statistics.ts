// Projects parsed City[] with resolved owner nation, governor name, family
// class, and culture level. Culture level is looked up by team_id from
// city_culture; team_id falls back to player.xmlId per the Rust COALESCE.

import type { Character } from "../parsers/characters.js";
import type { City, CityCulture, CityReligion } from "../parsers/cities.js";
import type { Family } from "../parsers/families.js";
import type { Player } from "../parsers/players.js";
import type { CityInfo, CityStatistics } from "../types.js";
import { playerByXmlId, strCmp } from "./_helpers.js";

export function deriveCityStatistics(
	cities: City[],
	cityCulture: CityCulture[],
	cityReligions: CityReligion[],
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

	// Religion presence per city (the same parse the map tiles consume).
	const religionsByCity = new Map<number, string[]>();
	for (const cr of cityReligions) {
		const list = religionsByCity.get(cr.cityXmlId) ?? [];
		list.push(cr.religion);
		religionsByCity.set(cr.cityXmlId, list);
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

		// Per-owner family, with its class resolved the same way as the current
		// family above. Lets the map's turn slider show a captured city's
		// founder family for turns before the capture — the family only changes
		// on conquest, so each player's entry is the family during their tenure.
		const playerFamilies = c.playerFamilies.map((pf) => ({
			player_xml_id: pf.playerXmlId,
			family: pf.familyName,
			family_class: familyByName.get(pf.familyName)?.familyClass ?? null,
		}));

		return {
			city_id: c.xmlId,
			tile_xml_id: c.tileXmlId,
			city_name: c.cityName,
			owner_nation: owner?.nation ?? null,
			owner_player_xml_id: c.playerXmlId,
			family: c.family,
			family_class: family?.familyClass ?? null,
			player_families: playerFamilies,
			first_owner_player_xml_id: c.firstOwnerPlayerXmlId,
			founded_turn: c.foundedTurn,
			is_capital: c.isCapital,
			citizens: c.citizens,
			governor_name: governor?.firstName ?? null,
			governor_xml_id: c.governorXmlId,
			religions: religionsByCity.get(c.xmlId) ?? [],
			project_counts: c.projectCounts,
			// The owner team's happiness level (same team resolution as
			// culture above); negative = discontent. Null for unowned cities,
			// 0 when neutral.
			happiness_level:
				teamForCulture !== null
					? (c.teamHappinessLevels.find((t) => t.teamId === teamForCulture)
							?.level ?? 0)
					: null,
			damage: c.damage,
			assimilate_turns: c.assimilateTurns,
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
