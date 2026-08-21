// City entity + 8 sub-entity parsers.
//
// Per spec §394 these live in one consolidated module rather than one per
// collection — all 9 share the same per-City iteration shape and benefit
// from being read together.

import {
	asArray,
	getElementChildren,
	isElement,
	optAttrStr,
	optInt,
	optStr,
	parseNameKeyedIntMap,
	parsePrefixedKeyedIntMap,
	requireInt,
	requireStr,
} from "../parse-xml.js";

// ---------- Types ----------

export interface City {
	xmlId: number;
	cityName: string;
	foundedTurn: number;
	playerXmlId: number | null;
	tileXmlId: number;
	family: string | null;
	// Per-player family associations from <PlayerFamily> (<P.X>FAMILY_Y</P.X>).
	// Retains each owning player's family across a capture — a city's family
	// only changes when another nation conquers it, so this is the historical
	// family record for the map's turn slider. Same shape as unit families
	// (parsers/units.ts parseUnitFamilies).
	playerFamilies: { playerXmlId: number; familyName: string }[];
	firstOwnerPlayerXmlId: number | null;
	lastOwnerPlayerXmlId: number | null;
	isCapital: boolean;
	citizens: number;
	governorXmlId: number | null;
	governorTurn: number | null;
	hurryCivicsCount: number;
	hurryMoneyCount: number;
	hurryTrainingCount: number;
	hurryPopulationCount: number;
	specialistCount: number;
	growthCount: number;
	unitProductionCount: number;
	buyTileCount: number;
	// Per-city project completions from <ProjectCount> (PROJECT_X → count) —
	// city projects like Archives and Forums that carry city effects.
	// (Religion presence is parsed separately — parseCityReligions.)
	projectCounts: { project: string; count: number }[];
}

export interface CityProductionItem {
	cityXmlId: number;
	queuePosition: number;
	buildType: string;
	itemType: string;
	progress: number;
	isRepeat: boolean;
}

export interface CityProjectCompleted {
	cityXmlId: number;
	projectType: string;
	count: number;
}

export interface CityProjectCount {
	cityXmlId: number;
	projectType: string;
	count: number;
}

export interface CityEnemyAgent {
	cityXmlId: number;
	enemyPlayerXmlId: number;
	agentCharacterXmlId: number | null;
	placedTurn: number | null;
	agentTileXmlId: number | null;
}

export interface CityLuxury {
	cityXmlId: number;
	resource: string;
	importedTurn: number;
}

export interface CityYield {
	cityXmlId: number;
	yieldType: string;
	progress: number;
}

export interface CityReligion {
	cityXmlId: number;
	religion: string;
}

export interface CityCulture {
	cityXmlId: number;
	teamId: number;
	cultureLevel: string | null;
	happinessLevel: number;
}

// ---------- Helpers ----------

function eachCity(
	root: Record<string, unknown>,
): Generator<[number, Record<string, unknown>]> {
	return (function* () {
		for (const node of asArray(root.City) as unknown[]) {
			if (!isElement(node)) continue;
			const cityXmlId = requireInt(node["@_ID"], "City.ID");
			yield [cityXmlId, node];
		}
	})();
}

// ---------- Cities core ----------

export function parseCities(root: Record<string, unknown>): City[] {
	const cities: City[] = [];

	for (const [, node] of eachCity(root)) {
		const xmlId = requireInt(node["@_ID"], "City.ID");
		const playerRaw = requireInt(node["@_Player"], "City.Player");
		const playerXmlId = playerRaw >= 0 ? playerRaw : null;
		const tileXmlId = requireInt(node["@_TileID"], "City.TileID");
		const foundedTurn = requireInt(node["@_Founded"], "City.Founded");

		// Older saves use <NameType>, newer use <Name>; default to literal
		// "Unknown City" if neither resolves to a non-empty string.
		const cityName =
			optStr(node.NameType) ?? optStr(node.Name) ?? "Unknown City";

		// is_capital: presence-of-element check. fast-xml-parser represents
		// <Capital/> as `Capital: ""`; the key is present iff the element is.
		const isCapital = "Capital" in node;

		// unit_production_count: prefer aggregate <UnitProductionCount>,
		// fall back to sum of <UnitProductionCounts> children, default 0.
		const aggregateUpc = optInt(node.UnitProductionCount);
		const unitProductionCount =
			aggregateUpc !== null
				? aggregateUpc
				: sumNamedIntChildren(node.UnitProductionCounts);

		// <PlayerFamily> holds <P.X>FAMILY_Y</P.X> for every player who has
		// owned this city — the same string-valued prefix-keyed shape as unit
		// families. Skip non-P.* tags, unparseable player
		// IDs, and empty values.
		const playerFamilies: { playerXmlId: number; familyName: string }[] = [];
		const familyNode = node.PlayerFamily;
		if (isElement(familyNode)) {
			for (const [tag, value] of getElementChildren(familyNode)) {
				if (!tag.startsWith("P.")) continue;
				const pid = parseInt(tag.slice(2), 10);
				if (Number.isNaN(pid)) continue;
				if (typeof value !== "string" || value === "") continue;
				playerFamilies.push({ playerXmlId: pid, familyName: value });
			}
		}

		const projectCounts = [...parseNameKeyedIntMap(node.ProjectCount)].map(
			([project, count]) => ({ project, count }),
		);

		cities.push({
			xmlId,
			cityName,
			foundedTurn,
			playerXmlId,
			tileXmlId,
			family: optAttrStr(node["@_Family"]),
			playerFamilies,
			firstOwnerPlayerXmlId: optInt(node.FirstPlayer),
			lastOwnerPlayerXmlId: optInt(node.LastPlayer),
			isCapital,
			citizens: optInt(node.Citizens) ?? 1,
			governorXmlId: optInt(node.GovernorID),
			governorTurn: optInt(node.GovernorTurn),
			hurryCivicsCount: optInt(node.HurryCivicsCount) ?? 0,
			hurryMoneyCount: optInt(node.HurryMoneyCount) ?? 0,
			hurryTrainingCount: optInt(node.HurryTrainingCount) ?? 0,
			hurryPopulationCount: optInt(node.HurryPopulationCount) ?? 0,
			specialistCount: optInt(node.SpecialistProducedCount) ?? 0,
			growthCount: optInt(node.GrowthCount) ?? 0,
			unitProductionCount,
			buyTileCount: optInt(node.BuyTileCount) ?? 0,
			projectCounts,
		});
	}

	return cities;
}

function sumNamedIntChildren(node: unknown): number {
	if (!isElement(node)) return 0;
	let sum = 0;
	for (const value of parseNameKeyedIntMap(node).values()) sum += value;
	return sum;
}

// ---------- Production queue ----------

export function parseCityProductionQueue(
	root: Record<string, unknown>,
): CityProductionItem[] {
	const items: CityProductionItem[] = [];

	for (const [cityXmlId, node] of eachCity(root)) {
		const queueNode = node.BuildQueue;
		if (!isElement(queueNode)) continue;

		let queuePosition = 0;
		for (const qi of asArray(queueNode.QueueInfo) as unknown[]) {
			if (!isElement(qi)) continue;
			items.push({
				cityXmlId,
				queuePosition: queuePosition++,
				buildType: requireStr(qi.Build, "QueueInfo.Build"),
				itemType: requireStr(qi.Type, "QueueInfo.Type"),
				progress: optInt(qi.Progress) ?? 0,
				// IsRepeat parses as int, then non-zero. Default false.
				isRepeat: (optInt(qi.IsRepeat) ?? 0) !== 0,
			});
		}
	}

	return items;
}

// ---------- Projects completed ----------

export function parseCityProjectsCompleted(
	root: Record<string, unknown>,
): CityProjectCompleted[] {
	const out: CityProjectCompleted[] = [];

	for (const [cityXmlId, node] of eachCity(root)) {
		const completedNode = node.CompletedBuild;
		if (!isElement(completedNode)) continue;

		const counts = new Map<string, number>();
		for (const qi of asArray(completedNode.QueueInfo) as unknown[]) {
			if (!isElement(qi)) continue;
			// Missing Build/Type both default to literal "UNKNOWN". A typical
			// CompletedBuild record has both, but be defensive — that exact
			// spelling is what Rust emits.
			const buildType = optStr(qi.Build) ?? "UNKNOWN";
			const itemType = optStr(qi.Type) ?? "UNKNOWN";
			const projectType = `${buildType}.${itemType}`;
			counts.set(projectType, (counts.get(projectType) ?? 0) + 1);
		}

		for (const [projectType, count] of counts) {
			out.push({ cityXmlId, projectType, count });
		}
	}

	return out;
}

// ---------- Project counts ----------

export function parseCityProjectCounts(
	root: Record<string, unknown>,
): CityProjectCount[] {
	const out: CityProjectCount[] = [];

	for (const [cityXmlId, node] of eachCity(root)) {
		const projectCountNode = node.ProjectCount;
		if (!isElement(projectCountNode)) continue;

		// Rust filters count > 0, so unparseable / zero-count entries are
		// dropped. parseNameKeyedIntMap already drops unparseable.
		for (const [projectType, count] of parseNameKeyedIntMap(projectCountNode)) {
			if (count > 0) {
				out.push({ cityXmlId, projectType, count });
			}
		}
	}

	return out;
}

// ---------- Enemy agents ----------

export function parseCityEnemyAgents(
	root: Record<string, unknown>,
): CityEnemyAgent[] {
	const out: CityEnemyAgent[] = [];

	for (const [cityXmlId, node] of eachCity(root)) {
		const turns = parsePrefixedKeyedIntMap(node.AgentTurn, "P.");
		const chars = parsePrefixedKeyedIntMap(node.AgentCharacterID, "P.");
		const tiles = parsePrefixedKeyedIntMap(node.AgentTileID, "P.");

		const enemies = new Set<number>([
			...turns.keys(),
			...chars.keys(),
			...tiles.keys(),
		]);

		for (const enemyPlayerXmlId of enemies) {
			out.push({
				cityXmlId,
				enemyPlayerXmlId,
				agentCharacterXmlId: chars.get(enemyPlayerXmlId) ?? null,
				placedTurn: turns.get(enemyPlayerXmlId) ?? null,
				agentTileXmlId: tiles.get(enemyPlayerXmlId) ?? null,
			});
		}
	}

	return out;
}

// ---------- Luxuries ----------

export function parseCityLuxuries(root: Record<string, unknown>): CityLuxury[] {
	const out: CityLuxury[] = [];

	for (const [cityXmlId, node] of eachCity(root)) {
		const luxuryNode = node.LuxuryTurn;
		if (!isElement(luxuryNode)) continue;

		for (const [resource, importedTurn] of parseNameKeyedIntMap(luxuryNode)) {
			out.push({ cityXmlId, resource, importedTurn });
		}
	}

	return out;
}

// ---------- Yields ----------

export function parseCityYields(root: Record<string, unknown>): CityYield[] {
	const out: CityYield[] = [];

	for (const [cityXmlId, node] of eachCity(root)) {
		const yieldNode = node.YieldProgress;
		if (!isElement(yieldNode)) continue;

		for (const [yieldType, progress] of parseNameKeyedIntMap(yieldNode)) {
			out.push({ cityXmlId, yieldType, progress });
		}
	}

	return out;
}

// ---------- Religions ----------

export function parseCityReligions(
	root: Record<string, unknown>,
): CityReligion[] {
	const out: CityReligion[] = [];

	for (const [cityXmlId, node] of eachCity(root)) {
		const religionNode = node.Religion;
		if (!isElement(religionNode)) continue;

		// Just collect element child names — values aren't used here.
		for (const [religion] of getElementChildren(religionNode)) {
			out.push({ cityXmlId, religion });
		}
	}

	return out;
}

// ---------- Culture ----------

export function parseCityCulture(root: Record<string, unknown>): CityCulture[] {
	const out: CityCulture[] = [];

	for (const [cityXmlId, node] of eachCity(root)) {
		// TeamCulture: <T.X>CULTURE_LEGENDARY</T.X> string-valued. Single-use
		// shape (string-valued prefix-keyed map) — inline the walk rather
		// than adding a one-off helper.
		const teamCulture = new Map<number, string>();
		const cultureNode = node.TeamCulture;
		if (isElement(cultureNode)) {
			for (const [tagName, value] of getElementChildren(cultureNode)) {
				if (!tagName.startsWith("T.")) continue;
				if (typeof value !== "string") continue;
				const teamId = parseInt(tagName.slice(2), 10);
				if (Number.isNaN(teamId)) continue;
				teamCulture.set(teamId, value);
			}
		}

		// Happiness: prefer <TeamHappinessLevel> (newer), fall back to
		// <TeamDiscontentLevel> (legacy 2022 saves).
		const happinessRaw =
			node.TeamHappinessLevel ?? node.TeamDiscontentLevel ?? null;
		const teamHappiness = parsePrefixedKeyedIntMap(happinessRaw, "T.");

		const teams = new Set<number>([
			...teamCulture.keys(),
			...teamHappiness.keys(),
		]);

		for (const teamId of teams) {
			out.push({
				cityXmlId,
				teamId,
				cultureLevel: teamCulture.get(teamId) ?? null,
				happinessLevel: teamHappiness.get(teamId) ?? 0,
			});
		}
	}

	return out;
}
