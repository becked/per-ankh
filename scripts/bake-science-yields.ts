// Bake the base science income of improvements and specialists from the OW
// reference XML, so the Techs tab's key-science-tech tooltips can show what
// a player's standing buildings/staff actually earn ("at least +X science").
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/improvement.xml — <aiYieldOutput>/<aiYieldRate> on the
//     entry, plus <EffectCity> → effectCity.xml <aiYieldRate> (flat science)
//     and <aiYieldModifier> (percent science, e.g. libraries).
//   Reference/XML/Infos/improvementClass.xml — <aaiResourceYieldOutput>:
//     per-resource outputs of resource-sited classes (a Grove's science is
//     entirely here — +2 on every grove resource — not on the improvement).
//   improvement.xml + improvementClass.xml, again — the neighbour terms of
//     Tile.yieldOutputForGovernor: <aiAdjacentImprovementModifier> and
//     <aiAdjacentImprovementClassModifier> (what an improvement grants the
//     tiles beside it) and <aiAdjacentResourceYieldOutput> (what a tile earns
//     per adjacent resource).
//   Reference/XML/Infos/specialist.xml — <EffectCity> + <EffectCityExtra>
//     (the Apprentice/Master/Elder extras carry the tier science) resolved
//     through effectCity.xml the same way.
//   Reference/XML/Infos/rating.xml — <aiYieldCourtRate> on RATING_WISDOM: the
//     per-turn science a court character earns off their Wisdom.
//   Reference/XML/Infos/yield.xml — YIELD_SCIENCE <iTriangleOffset>, the offset
//     the court rating curve (Utils.triangleOffset) is evaluated at.
//   Reference/XML/Infos/globalsInt.xml — RATING_EQUIVALENT_LOWER_CHARACTER_YIELDS,
//     the rating Competitive Mode linearizes the court curve around.
//   Reference/XML/Infos/effectPlayer.xml — EFFECTPLAYER_COMPETITIVE_MODE
//     <aiYieldRate> YIELD_SCIENCE, Competitive Mode's flat science stipend.
//   Reference/XML/Infos/lawClass.xml + law.xml — each law class carries the
//     <TechPrereq> and each law its <Class>; inverted into the tech →
//     laws-it-unlocks table the tech-timeline ◆ markers use.
//   Reference/XML/Infos/tech.xml — <iCost> per tech, resolved through each
//     source's unlocking tech into the *_UNLOCK_COST tables that order the
//     Science Sources rows early-tech → late-tech.
//
// Values are the game's ×10 fixed-point; emitted ÷10 in display units. The
// one exception is WISDOM_COURT_SCIENCE_RATE — see its comment below.
// Only science-positive entries are emitted. Shrines additionally get their
// type — War/Fire/Sun/Wisdom/… — from the <AssetVariation> suffix (the same
// source owreference's shrine page uses).
//
// OUTPUT: src/lib/generated/science-yields.ts (checked in, self-contained —
// no .bake sidecar, so bake:finalize never wipes it when this hasn't run).
//
// Run: npm run bake:science-yields

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";
import { format as prettierFormat, resolveConfig } from "prettier";

import { resolveReferenceXml } from "./lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_TS = resolve(REPO_ROOT, "src/lib/generated/science-yields.ts");

interface YieldPair {
	zIndex?: string;
	iValue?: string;
}
interface SubPair {
	zSubIndex?: string;
	iValue?: string;
}
interface ResourceYieldPair {
	zIndex?: string;
	SubPair?: SubPair | SubPair[];
}
// A <Pair> mapping one type to another rather than to a number, the shape
// <aeEffectCityEffectCity> uses: "when the city also holds zIndex, add zValue".
interface TypePair {
	zIndex?: string;
	zValue?: string;
}
interface Entry {
	zType?: string;
	Class?: string;
	AssetVariation?: string;
	EffectCity?: string;
	EffectCityExtra?: string;
	EffectPlayer?: string;
	TechPrereq?: string;
	LawClass?: string;
	Specialist?: string;
	zIconName?: string;
	iCost?: string;
	iValue?: string;
	iPercent?: string;
	iTriangleOffset?: string;
	iNegativeHappinessModifier?: string;
	iCityHP?: string;
	bNoDamage?: string;
	bNoAssimilate?: string;
	LeaderEffectPlayer?: string;
	// trait.xml — the effect a character carries into the city they GOVERN.
	GovernorEffectCity?: string;
	aiYieldOutput?: { Pair?: YieldPair | YieldPair[] };
	aiYieldRate?: { Pair?: YieldPair | YieldPair[] };
	aiYieldModifier?: { Pair?: YieldPair | YieldPair[] };
	aiYieldCourtRate?: { Pair?: YieldPair | YieldPair[] };
	aiYieldGovernorModifier?: { Pair?: YieldPair | YieldPair[] };
	aiYieldRateSpecialist?: { Pair?: YieldPair | YieldPair[] };
	aiYieldRateReligion?: { Pair?: YieldPair | YieldPair[] };
	aiImprovementModifier?: { Pair?: YieldPair | YieldPair[] };
	aiImprovementClassModifier?: { Pair?: YieldPair | YieldPair[] };
	// The neighbour terms of Tile.yieldOutputForGovernor: the percent an
	// improvement grants the tiles NEXT to it, and the flat yield a tile earns
	// per adjacent resource.
	aiAdjacentImprovementModifier?: { Pair?: YieldPair | YieldPair[] };
	aiAdjacentImprovementClassModifier?: { Pair?: YieldPair | YieldPair[] };
	aiAdjacentResourceYieldOutput?: { Pair?: YieldPair | YieldPair[] };
	aaiResourceYieldOutput?: { Pair?: ResourceYieldPair | ResourceYieldPair[] };
	// "when effect <zIndex> is present in this city, pay <SubPair>" — the shape
	// Philosophy's Forum science and the Scholar archetype's Archive science use.
	aaiEffectCityYieldRate?: { Pair?: ResourceYieldPair | ResourceYieldPair[] };
	aeEffectCityEffectCity?: { Pair?: TypePair | TypePair[] };
}

const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
});

async function loadEntries(path: string): Promise<Entry[]> {
	const xml = await readFile(path, "utf-8");
	const parsed = parser.parse(xml) as { Root?: { Entry?: Entry | Entry[] } };
	const entry = parsed.Root?.Entry;
	if (entry == null) return [];
	return Array.isArray(entry) ? entry : [entry];
}

// The project-definition files: the base table plus the event projects, whose
// DLC variants are hyphenated (project-event-eoti.xml, …). Same predicate
// bake-project-icons.ts uses — the event projects carry science of their own
// (PROJECT_LOCAL_ASCETIC, PROJECT_NEIGHBORS_FEAST_PERSIA both pay +2), so a
// sweep of project.xml alone silently drops them.
function isProjectDefFile(name: string): boolean {
	return name === "project.xml" || /^project-event(-.*)?\.xml$/.test(name);
}

async function loadProjects(infosDir: string): Promise<Entry[]> {
	const files = (await readdir(infosDir)).filter(isProjectDefFile).sort();
	const loaded = await Promise.all(
		files.map((f) => loadEntries(resolve(infosDir, f))),
	);
	return loaded.flat();
}

function pairs(block?: { Pair?: YieldPair | YieldPair[] }): YieldPair[] {
	const p = block?.Pair;
	if (p == null) return [];
	return Array.isArray(p) ? p : [p];
}

function yieldValue(block: YieldPair[], yieldType: string): number {
	return block
		.filter((p) => p.zIndex === yieldType)
		.reduce((t, p) => t + Number(p.iValue ?? 0), 0);
}

// The per-index science of an `aai*` two-level table ({ zIndex → { zSubIndex →
// iValue } }), in the game's raw ×10 units. Two tables share the shape:
// <aaiResourceYieldOutput> (improvement class → resource) and
// <aaiEffectCityYieldRate> (effect → the city effect whose presence pays it).
function nestedScience(block?: {
	Pair?: ResourceYieldPair | ResourceYieldPair[];
}): Record<string, number> {
	const p = block?.Pair;
	const rows = p == null ? [] : Array.isArray(p) ? p : [p];
	const out: Record<string, number> = {};
	for (const row of rows) {
		if (!row.zIndex) continue;
		const subs =
			row.SubPair == null
				? []
				: Array.isArray(row.SubPair)
					? row.SubPair
					: [row.SubPair];
		const science = subs
			.filter((sub) => sub.zSubIndex === "YIELD_SCIENCE")
			.reduce((total, sub) => total + Number(sub.iValue ?? 0), 0);
		if (science !== 0) out[row.zIndex] = science;
	}
	return out;
}

async function main(): Promise<void> {
	const infosDir = resolve(resolveReferenceXml(), "Infos");
	const [
		improvements,
		improvementClasses,
		specialists,
		effects,
		ratings,
		yields,
		globalInts,
		effectPlayers,
		laws,
		lawClasses,
		techs,
		familyClasses,
		nations,
		theologies,
		projects,
		knowledges,
		traits,
	] = await Promise.all([
		loadEntries(resolve(infosDir, "improvement.xml")),
		loadEntries(resolve(infosDir, "improvementClass.xml")),
		loadEntries(resolve(infosDir, "specialist.xml")),
		loadEntries(resolve(infosDir, "effectCity.xml")),
		loadEntries(resolve(infosDir, "rating.xml")),
		loadEntries(resolve(infosDir, "yield.xml")),
		loadEntries(resolve(infosDir, "globalsInt.xml")),
		loadEntries(resolve(infosDir, "effectPlayer.xml")),
		loadEntries(resolve(infosDir, "law.xml")),
		loadEntries(resolve(infosDir, "lawClass.xml")),
		loadEntries(resolve(infosDir, "tech.xml")),
		loadEntries(resolve(infosDir, "familyClass.xml")),
		loadEntries(resolve(infosDir, "nation.xml")),
		loadEntries(resolve(infosDir, "theology.xml")),
		loadProjects(infosDir),
		loadEntries(resolve(infosDir, "knowledge.xml")),
		loadEntries(resolve(infosDir, "trait.xml")),
	]);

	const effectByType = new Map(effects.map((e) => [e.zType, e]));

	// The court constants are single scalars rather than tables, so a silent
	// 0 from a renamed tag would poison the breakdown rather than show up as
	// a missing row. Fail the bake instead.
	const findEntry = (
		entries: Entry[],
		zType: string,
		source: string,
	): Entry => {
		const found = entries.find((e) => e.zType === zType);
		if (!found)
			throw new Error(`bake-science-yields: ${zType} not in ${source}`);
		return found;
	};
	const requireInt = (raw: string | undefined, what: string): number => {
		const n = Number(raw);
		if (raw == null || Number.isNaN(n)) {
			throw new Error(`bake-science-yields: ${what} missing or non-numeric`);
		}
		return n;
	};

	// RATING_WISDOM is the only rating with a science court rate (Charisma
	// pays Civics, Courage Training, Discipline Money), so the leader's court
	// science is this term alone.
	const wisdomCourtScienceRate = yieldValue(
		pairs(findEntry(ratings, "RATING_WISDOM", "rating.xml").aiYieldCourtRate),
		"YIELD_SCIENCE",
	);
	if (wisdomCourtScienceRate === 0) {
		throw new Error(
			"bake-science-yields: RATING_WISDOM has no YIELD_SCIENCE aiYieldCourtRate",
		);
	}
	const scienceTriangleOffset = requireInt(
		findEntry(yields, "YIELD_SCIENCE", "yield.xml").iTriangleOffset,
		"YIELD_SCIENCE iTriangleOffset",
	);
	// Percent science per city discontent level (yield.xml
	// <iNegativeHappinessModifier>, applied ×|happiness level| when the level
	// is negative — InfoHelpers.getHappinessLevelYieldModifier). Negative.
	const scienceDiscontentModifier = requireInt(
		findEntry(yields, "YIELD_SCIENCE", "yield.xml").iNegativeHappinessModifier,
		"YIELD_SCIENCE iNegativeHappinessModifier",
	);
	if (scienceDiscontentModifier >= 0) {
		throw new Error(
			"bake-science-yields: YIELD_SCIENCE iNegativeHappinessModifier is not negative",
		);
	}
	// Damage and assimilation are the other two terms of
	// City.calculateTotalYieldModifier (governor + happiness + damage +
	// assimilate). A yield opts out of either with <bNoDamage>/<bNoAssimilate>;
	// YIELD_SCIENCE sets neither, so both apply to science. Assert it rather
	// than assume — a patch that opts science out would otherwise leave the
	// breakdown quietly charging a penalty the game stopped applying.
	const scienceYield = findEntry(yields, "YIELD_SCIENCE", "yield.xml");
	if (scienceYield.bNoDamage === "1" || scienceYield.bNoAssimilate === "1") {
		throw new Error(
			"bake-science-yields: YIELD_SCIENCE now sets bNoDamage/bNoAssimilate — " +
				"the damage and assimilation rows in the science breakdown must go",
		);
	}
	// Percent yield per point of city damage is (damage × modifier) / HPMax,
	// and assimilation is max(-turns, modifier) — both negative, both capped
	// by the same globals.
	const cityDamageYieldModifier = requireInt(
		findEntry(globalInts, "CITY_DAMAGE_YIELD_MODIFIER", "globalsInt.xml")
			.iValue,
		"CITY_DAMAGE_YIELD_MODIFIER iValue",
	);
	const cityAssimilateYieldModifier = requireInt(
		findEntry(globalInts, "CITY_ASSIMILATE_YIELD_MODIFIER", "globalsInt.xml")
			.iValue,
		"CITY_ASSIMILATE_YIELD_MODIFIER iValue",
	);
	// The damage denominator's base: getHPMax() is CITY_HP + the HP a city's
	// own effects add (City.cs:2311).
	const cityHpBase = requireInt(
		findEntry(globalInts, "CITY_HP", "globalsInt.xml").iValue,
		"CITY_HP iValue",
	);

	const competitiveEquivalentRating = requireInt(
		findEntry(
			globalInts,
			"RATING_EQUIVALENT_LOWER_CHARACTER_YIELDS",
			"globalsInt.xml",
		).iValue,
		"RATING_EQUIVALENT_LOWER_CHARACTER_YIELDS iValue",
	);
	const competitiveScienceStipend =
		yieldValue(
			pairs(
				findEntry(
					effectPlayers,
					"EFFECTPLAYER_COMPETITIVE_MODE",
					"effectPlayer.xml",
				).aiYieldRate,
			),
			"YIELD_SCIENCE",
		) / 10;

	// Percent city science per boosted point of the governor's Wisdom
	// (rating.xml <aiYieldGovernorModifier>). RAW percent — the consumer
	// multiplies by Utils.triangleBoost(wisdom) (or the Competitive
	// linearization), so this is NOT ÷10 fixed point.
	const wisdomGovernorScienceModifier = yieldValue(
		pairs(
			findEntry(ratings, "RATING_WISDOM", "rating.xml").aiYieldGovernorModifier,
		),
		"YIELD_SCIENCE",
	);
	if (wisdomGovernorScienceModifier === 0) {
		throw new Error(
			"bake-science-yields: RATING_WISDOM has no YIELD_SCIENCE aiYieldGovernorModifier",
		);
	}

	// Family classes whose city effect pays flat science per placed specialist
	// (effectCity <aiYieldRateSpecialist> — any specialist, unlike
	// Constitution's urban-only tag). Sages is the only one today; baking the
	// whole table keeps the authority in the XML.
	const familyClassSciencePerSpecialist: Record<string, number> = {};
	for (const fc of familyClasses) {
		if (!fc.zType) continue;
		const e = fc.EffectCity ? effectByType.get(fc.EffectCity) : undefined;
		const v = e
			? yieldValue(pairs(e.aiYieldRateSpecialist), "YIELD_SCIENCE")
			: 0;
		if (v > 0) familyClassSciencePerSpecialist[fc.zType] = v / 10;
	}

	// Nations whose player effect grants flat city science (nation.xml
	// EffectPlayer → effectPlayer.xml EffectCity → effectCity <aiYieldRate>,
	// applied to every city). Babylonia is the only one today.
	const effectPlayerByType = new Map(effectPlayers.map((e) => [e.zType, e]));
	const nationCityScience: Record<string, number> = {};
	for (const n of nations) {
		if (!n.zType) continue;
		const ep = n.EffectPlayer
			? effectPlayerByType.get(n.EffectPlayer)
			: undefined;
		const e = ep?.EffectCity ? effectByType.get(ep.EffectCity) : undefined;
		const v = e ? yieldValue(pairs(e.aiYieldRate), "YIELD_SCIENCE") : 0;
		if (v > 0) nationCityScience[n.zType] = v / 10;
	}

	// Theologies whose city effect pays science per religion PRESENT in the
	// city (effectCity <aiYieldRateReligion> × City.getReligionCount()). The
	// effect lands on every city where a religion holding the theology is
	// present. Dualism is the only one today.
	const theologySciencePerReligion: Record<string, number> = {};
	for (const t of theologies) {
		if (!t.zType) continue;
		const e = t.EffectCity ? effectByType.get(t.EffectCity) : undefined;
		const v = e ? yieldValue(pairs(e.aiYieldRateReligion), "YIELD_SCIENCE") : 0;
		if (v > 0) theologySciencePerReligion[t.zType] = v / 10;
	}

	// Every city effect a completed project puts in the city — its <EffectCity>
	// and <EffectCityExtra>. Both the conditional-grant tables and the city-HP
	// table below key on these, because the XML expresses "a city holding an
	// Archive" as the effect, not the project.
	const projectEffects = new Map<string, string[]>();
	for (const p of projects) {
		if (!p.zType) continue;
		const names = [p.EffectCity, p.EffectCityExtra].filter(
			(n): n is string => n != null && n !== "",
		);
		if (names.length > 0) projectEffects.set(p.zType, names);
	}
	// Effect → the projects that grant it, the inversion the conditional
	// grants need (they name the effect; the blob records the project).
	const projectsByEffect = new Map<string, string[]>();
	for (const [project, names] of projectEffects) {
		for (const name of names) {
			projectsByEffect.set(name, [
				...(projectsByEffect.get(name) ?? []),
				project,
			]);
		}
	}

	// City projects whose effect pays flat science (project.xml EffectCity +
	// EffectCityExtra → effectCity <aiYieldRate>): the Archive tiers
	// (+1/+2/+4/+8) and friends. City.cs:5058 keeps both effect counts equal
	// to the project count, but a <bSingle> effect pays once no matter the
	// count — `single` tells the consumer to cap the count at 1 (Archives,
	// the no-characters Governor project) vs. multiply (Convoys).
	//
	// Tiers don't stack, but bSingle is not why: each tier is its own project
	// with its own effect, and <abInvalidBy> + City.finishProject
	// (City.cs:8589) zero the count of every tier a new one invalidates, so a
	// save only ever carries the top tier of a line. Summing the tiers a city
	// reports is therefore safe.
	const projectScience: Record<string, { science: number; single: boolean }> =
		{};
	for (const p of projects) {
		if (!p.zType) continue;
		let science = 0;
		let single = false;
		for (const name of projectEffects.get(p.zType) ?? []) {
			const e = effectByType.get(name);
			const v = e ? yieldValue(pairs(e.aiYieldRate), "YIELD_SCIENCE") : 0;
			if (v > 0) {
				science += v;
				single ||= (e as { bSingle?: string } | undefined)?.bSingle === "1";
			}
		}
		if (science > 0)
			projectScience[p.zType] = { science: science / 10, single };
	}

	// Conditional grants: "pay science in every city holding effect X", the
	// <aaiEffectCityYieldRate> shape. Two sources reach it with data the blob
	// records — a law the player has active, and their leader's archetype —
	// and both land on projects: Philosophy pays +1 per Forum city,
	// the Scholar archetype +2 per Archive city. Resolved here down to
	// source → project → science so the consumer needs no effect graph.
	const grantsFromEffects = (names: (string | undefined)[]) => {
		const byProject: Record<string, number> = {};
		for (const name of names) {
			const effect = name ? effectByType.get(name) : undefined;
			if (!effect) continue;
			for (const [target, science] of Object.entries(
				nestedScience(effect.aaiEffectCityYieldRate),
			)) {
				if (science <= 0) continue;
				for (const project of projectsByEffect.get(target) ?? []) {
					byProject[project] = (byProject[project] ?? 0) + science / 10;
				}
			}
		}
		return byProject;
	};
	// A law's or trait's effects reach the city through its player effect:
	// law.xml <EffectPlayer> / trait.xml <LeaderEffectPlayer> → effectPlayer
	// .xml <EffectCity> + <EffectCityExtra>.
	const cityEffectsOfPlayerEffect = (name?: string): (string | undefined)[] => {
		const ep = name ? effectPlayerByType.get(name) : undefined;
		return ep ? [ep.EffectCity, ep.EffectCityExtra] : [];
	};
	const lawProjectScience: Record<string, Record<string, number>> = {};
	for (const law of laws) {
		if (!law.zType) continue;
		const grants = grantsFromEffects(
			cityEffectsOfPlayerEffect(law.EffectPlayer),
		);
		if (Object.keys(grants).length > 0) lawProjectScience[law.zType] = grants;
	}
	const archetypeProjectScience: Record<string, Record<string, number>> = {};
	for (const trait of traits) {
		if (!trait.zType) continue;
		const grants = grantsFromEffects(
			cityEffectsOfPlayerEffect(trait.LeaderEffectPlayer),
		);
		if (Object.keys(grants).length > 0) {
			archetypeProjectScience[trait.zType] = grants;
		}
	}

	// City HP a completed project adds (effectCity <iCityHP>), the denominator
	// of the damage yield modifier. All four are <bSingle>, so a project pays
	// its HP once however many times it was completed.
	const projectCityHp: Record<string, number> = {};
	for (const [project, names] of projectEffects) {
		let hp = 0;
		for (const name of names) {
			hp += Number(effectByType.get(name)?.iCityHP ?? 0);
		}
		if (hp > 0) projectCityHp[project] = hp;
	}

	// Knowledge tiers (knowledge.xml), in file order. `percent` is the tier's
	// inclusive upper bound on (their science total × 100 / ours), integer
	// division; the entry with no iPercent (Erudite) is the catch-all —
	// InfoPercentBase defaults miPercent to int.MaxValue.
	const knowledgeTiers = knowledges
		.filter((k) => k.zType)
		.map((k) => ({
			type: k.zType!,
			percent: k.iPercent != null ? Number(k.iPercent) : null,
		}));
	if (knowledgeTiers.length === 0) {
		throw new Error("bake-science-yields: knowledge.xml yielded no tiers");
	}

	// Per-resource science of resource-sited improvement classes (groves):
	// class → { RESOURCE_* → display science }.
	const classResourceScience = new Map<string, Record<string, number>>();
	for (const cls of improvementClasses) {
		if (!cls.zType) continue;
		const byResource: Record<string, number> = {};
		for (const [resource, science] of Object.entries(
			nestedScience(cls.aaiResourceYieldOutput),
		)) {
			if (science > 0) byResource[resource] = science / 10;
		}
		if (Object.keys(byResource).length > 0) {
			classResourceScience.set(cls.zType, byResource);
		}
	}
	const effectScience = (name?: string): { flat: number; pct: number } => {
		const e = name ? effectByType.get(name) : undefined;
		return e
			? {
					flat: yieldValue(pairs(e.aiYieldRate), "YIELD_SCIENCE"),
					pct: yieldValue(pairs(e.aiYieldModifier), "YIELD_SCIENCE"),
				}
			: { flat: 0, pct: 0 };
	};

	const improvementScience: Record<string, { flat: number; pct: number }> = {};
	const improvementResourceScience: Record<string, Record<string, number>> = {};
	// Improvement → its class, for science-relevant improvements only — the
	// key the specialist tile modifiers above are looked up by.
	const improvementClass: Record<string, string> = {};
	const shrineType: Record<string, string> = {};
	for (const imp of improvements) {
		if (!imp.zType) continue;
		const own =
			yieldValue(pairs(imp.aiYieldOutput), "YIELD_SCIENCE") +
			yieldValue(pairs(imp.aiYieldRate), "YIELD_SCIENCE");
		const eff = effectScience(imp.EffectCity);
		const flat = own + eff.flat;
		if (flat > 0 || eff.pct > 0) {
			improvementScience[imp.zType] = { flat: flat / 10, pct: eff.pct };
		}
		// The tile-modifier tables below multiply this `flat` as a TILE yield,
		// which holds only while none of it arrives through <EffectCity> — a
		// city effect is added after the tile's modifiers, not multiplied by
		// them (Tile.yieldOutputForGovernor → yieldOutputCityEffects). True of
		// every science improvement today; if a patch changes that, the field
		// has to split into its tile and city halves rather than drift.
		if (eff.flat > 0) {
			throw new Error(
				`bake-science-yields: ${imp.zType} pays flat science through ${imp.EffectCity}, which the tile modifiers would wrongly multiply — split ImprovementScience.flat`,
			);
		}
		const byResource = imp.Class
			? classResourceScience.get(imp.Class)
			: undefined;
		if (byResource) improvementResourceScience[imp.zType] = byResource;
		if (imp.Class && (flat > 0 || eff.pct > 0 || byResource)) {
			improvementClass[imp.zType] = imp.Class;
		}
		if (imp.zType.startsWith("IMPROVEMENT_SHRINE_") && imp.AssetVariation) {
			// "ASSET_VARIATION_IMPROVEMENT_SHRINE_WISDOM" → "Wisdom".
			const raw = imp.AssetVariation.replace(
				/^ASSET_VARIATION_IMPROVEMENT_SHRINE_/,
				"",
			);
			shrineType[imp.zType] = raw
				.split("_")
				.map((w) => w.charAt(0) + w.slice(1).toLowerCase())
				.join(" ");
		}
	}

	// ─── Tile modifiers: the two halves of yieldModifierNoSpecialist ─────
	//
	// A tile's yield is not its base output. Tile.yieldOutputForGovernor
	// (Tile.cs:13233) runs base → × tile modifiers → × the staffing
	// specialist's class modifier, and the base itself (yieldBaseForGovernor,
	// :13364) already carries a per-adjacent-resource term. Only the specialist
	// step was modelled before.
	//
	// yieldModifierNoSpecialist (:13479) sums two sources, baked into separate
	// tables because a blob resolves them differently: what the tile's
	// NEIGHBOURS grant it, and what the CITY it sits in grants it
	// (City.getImprovementModifierForGovernor, City.cs:4646).
	//
	// Both key by improvement zType OR improvement class, exactly as the XML
	// writes each rule — the two token spaces can't collide, so nothing has to
	// be expanded (one Kush shrine rule would otherwise fan out to 53
	// improvements) and the per-religion pairs can't cross (a Temple lifts only
	// its own religion's Monastery because the XML pairs improvements there,
	// and classes in the Monastery→Grove rule).
	//
	// Only rules whose TARGET can produce science are emitted, which is what
	// keeps these to a handful rather than every farm and mine rule in the game.
	const improvementsOfClass = new Map<string, string[]>();
	const classOfImprovement = new Map<string, string>();
	for (const imp of improvements) {
		if (!imp.zType || !imp.Class) continue;
		classOfImprovement.set(imp.zType, imp.Class);
		const list = improvementsOfClass.get(imp.Class) ?? [];
		list.push(imp.zType);
		improvementsOfClass.set(imp.Class, list);
	}
	const improvementProducesScience = (zType: string): boolean =>
		(improvementScience[zType]?.flat ?? 0) > 0 ||
		improvementResourceScience[zType] != null;
	// A token is either an improvement or a class; a class counts when any of
	// its improvements pays science. Declared before the tables below fill it,
	// because the per-adjacent-resource yield counts too — a library earns no
	// science of its own, but a percent modifier on one would still multiply
	// what its neighbouring resources pay it.
	const producesScience = (token: string): boolean => {
		const pays = (zType: string) =>
			improvementProducesScience(zType) ||
			improvementAdjacentResourceScience[zType] != null;
		return (
			pays(token) || (improvementsOfClass.get(token) ?? []).some((z) => pays(z))
		);
	};
	// The class of every token a rule can name, so the breakdown can label a
	// row by class. A granting Temple pays no science of its own and would
	// otherwise be absent from IMPROVEMENT_CLASS.
	const recordClass = (token: string): void => {
		const cls = classOfImprovement.get(token);
		if (cls) improvementClass[token] = cls;
	};

	// Improvement → science per adjacent resource tile the team owns
	// (Tile.countTeamAdjacentResources). The library line carries the only
	// science one, on its CLASS; the improvement-level table is read too
	// because the game sums both.
	const classAdjacentResourceScience = new Map<string, number>();
	for (const cls of improvementClasses) {
		if (!cls.zType) continue;
		const science = yieldValue(
			pairs(cls.aiAdjacentResourceYieldOutput),
			"YIELD_SCIENCE",
		);
		if (science !== 0) classAdjacentResourceScience.set(cls.zType, science);
	}
	const improvementAdjacentResourceScience: Record<string, number> = {};
	for (const imp of improvements) {
		if (!imp.zType) continue;
		const science =
			yieldValue(pairs(imp.aiAdjacentResourceYieldOutput), "YIELD_SCIENCE") +
			(imp.Class ? (classAdjacentResourceScience.get(imp.Class) ?? 0) : 0);
		if (science > 0) {
			improvementAdjacentResourceScience[imp.zType] = science / 10;
			recordClass(imp.zType);
		}
	}

	// Adjacency. DIRECTION IS INVERTED FROM HOW THE XML READS: InfoHelpers
	// .adjacentYieldOutputImprovementModifier(eImprovement, eAdjacent)
	// (InfoHelpers.cs:2025) looks its three tables up on eAdjacent — the
	// NEIGHBOUR — keyed by the improvement being modified. So
	// <IMPROVEMENTCLASS_MONASTERY><aiAdjacentImprovementClassModifier>
	// <IMPROVEMENTCLASS_GROVE>60 means a Monastery grants +60% to the Groves
	// beside it, not the reverse.
	const adjacentModifier: Record<string, Record<string, number>> = {};
	const grantAdjacent = (
		source: string | undefined,
		target: string | undefined,
		percent: number,
	): void => {
		if (!source || !target || percent === 0 || !producesScience(target)) return;
		const row = (adjacentModifier[source] ??= {});
		row[target] = (row[target] ?? 0) + percent;
		recordClass(source);
		recordClass(target);
	};
	for (const source of improvements) {
		// improvement(eAdjacent).maiAdjacentImprovementModifier[eImprovement]
		for (const p of pairs(source.aiAdjacentImprovementModifier)) {
			grantAdjacent(source.zType, p.zIndex, Number(p.iValue ?? 0));
		}
		// improvement(eAdjacent).maiAdjacentImprovementClassModifier[eClass]
		for (const p of pairs(source.aiAdjacentImprovementClassModifier)) {
			grantAdjacent(source.zType, p.zIndex, Number(p.iValue ?? 0));
		}
	}
	for (const cls of improvementClasses) {
		// improvementClass(eAdjacentClass).maiAdjacentImprovementClassModifier
		for (const p of pairs(cls.aiAdjacentImprovementClassModifier)) {
			grantAdjacent(cls.zType, p.zIndex, Number(p.iValue ?? 0));
		}
	}
	if (Object.keys(adjacentModifier).length === 0) {
		throw new Error(
			"bake-science-yields: no science adjacency modifiers found (Monastery→Grove is the canonical one) — the improvement XML shape changed",
		);
	}

	// The city half. Everything a city holds is an EffectCity, and each can
	// carry <aiImprovementModifier> / <aiImprovementClassModifier> — a Clerics
	// family doubles its cities' monasteries, a Cultivator governor lifts their
	// groves. Resolved per SOURCE below, because that is what a blob records:
	// the city's family class, its completed projects, the player's nation, the
	// governing character's traits, the wonders standing in it.
	//
	// <EffectCityUnlock> is followed, as changeEffectCity does (Tile.cs:13567).
	// <aeEffectCityEffectCity> — "if the city also holds effect X, add Y", the
	// Aksum Stele's shape — is NOT: those grant city percent modifiers, not
	// improvement ones, so none of them reaches this table today.
	const effectImprovementModifier = (
		name: string | undefined,
		seen = new Set<string>(),
	): Record<string, number> => {
		const out: Record<string, number> = {};
		if (!name || seen.has(name)) return out;
		seen.add(name);
		const e = effectByType.get(name);
		if (!e) return out;
		for (const block of [
			e.aiImprovementModifier,
			e.aiImprovementClassModifier,
		]) {
			for (const p of pairs(block)) {
				const percent = Number(p.iValue ?? 0);
				if (!p.zIndex || percent === 0 || !producesScience(p.zIndex)) continue;
				out[p.zIndex] = (out[p.zIndex] ?? 0) + percent;
				recordClass(p.zIndex);
			}
		}
		for (const [token, percent] of Object.entries(
			effectImprovementModifier(e.EffectCityUnlock, seen),
		)) {
			out[token] = (out[token] ?? 0) + percent;
		}
		return out;
	};
	const mergeModifiers = (
		effects: (string | undefined)[],
	): Record<string, number> => {
		const out: Record<string, number> = {};
		for (const name of effects) {
			for (const [token, percent] of Object.entries(
				effectImprovementModifier(name),
			)) {
				out[token] = (out[token] ?? 0) + percent;
			}
		}
		return out;
	};
	const bySource = (
		entries: Entry[],
		effectsOf: (entry: Entry) => (string | undefined)[],
	): Record<string, Record<string, number>> => {
		const out: Record<string, Record<string, number>> = {};
		for (const entry of entries) {
			if (!entry.zType) continue;
			const mods = mergeModifiers(effectsOf(entry));
			if (Object.keys(mods).length > 0) out[entry.zType] = mods;
		}
		return out;
	};
	const familyClassImprovementModifier = bySource(familyClasses, (fc) => [
		fc.EffectCity,
	]);
	const projectImprovementModifier = bySource(projects, (p) => [
		p.EffectCity,
		p.EffectCityExtra,
	]);
	const nationImprovementModifier = bySource(nations, (n) =>
		cityEffectsOfPlayerEffect(n.EffectPlayer),
	);
	// A trait reaches a city two ways, with different scope: through the
	// character GOVERNING it (trait.xml <GovernorEffectCity>, applied in
	// City.getEffectCityCountsForGovernor) and, when the RULER carries it,
	// through the player effect that reaches every city.
	const governorTraitImprovementModifier = bySource(traits, (t) => [
		t.GovernorEffectCity,
	]);
	const leaderTraitImprovementModifier = bySource(traits, (t) =>
		cityEffectsOfPlayerEffect(t.LeaderEffectPlayer),
	);
	// Conditional city modifiers: <aeEffectCityEffectCity> is "when the city
	// ALSO holds effect X, add effect Y" (City.addEffectYield, City.cs:4697,
	// which multiplies the two effects' counts). The three Aksum Stele tiers
	// are the only science ones and every condition is a family class, so the
	// table keys by that; anything else throws rather than being dropped.
	const familyClassOfEffect = new Map<string, string>();
	for (const fc of familyClasses) {
		if (fc.zType && fc.EffectCity)
			familyClassOfEffect.set(fc.EffectCity, fc.zType);
	}
	const typePairs = (block?: { Pair?: TypePair | TypePair[] }): TypePair[] => {
		const p = block?.Pair;
		if (p == null) return [];
		return Array.isArray(p) ? p : [p];
	};
	const improvementFamilyClassScience: Record<
		string,
		Record<string, number>
	> = {};
	for (const imp of improvements) {
		if (!imp.zType || !imp.EffectCity) continue;
		const effect = effectByType.get(imp.EffectCity);
		if (!effect) continue;
		for (const pair of typePairs(effect.aeEffectCityEffectCity)) {
			if (!pair.zIndex || !pair.zValue) continue;
			const bonus = effectByType.get(pair.zValue);
			if (!bonus) continue;
			const percent = yieldValue(pairs(bonus.aiYieldModifier), "YIELD_SCIENCE");
			const flat = yieldValue(pairs(bonus.aiYieldRate), "YIELD_SCIENCE");
			if (percent === 0 && flat === 0) continue;
			if (flat !== 0) {
				throw new Error(
					`bake-science-yields: ${pair.zValue} pays FLAT conditional science, which belongs with the city-effect rows, not the percent modifiers`,
				);
			}
			const familyClass = familyClassOfEffect.get(pair.zIndex);
			if (!familyClass) {
				throw new Error(
					`bake-science-yields: ${imp.zType} grants science when a city holds ${pair.zIndex}, which is not a family-class effect — the condition needs resolving from the blob before it can be baked`,
				);
			}
			const row = (improvementFamilyClassScience[imp.zType] ??= {});
			row[familyClass] = (row[familyClass] ?? 0) + percent;
		}
	}

	// A wonder standing in the city could grant one too, but the only science
	// rule of that shape today — the Cult of the Mother's +50% to shrines —
	// is defined in improvement-event-sap.xml, and this bake sweeps only
	// improvement.xml. Left unmodelled rather than half-swept; widening the
	// improvement load is its own change, since it would move every table here.

	const specialistScience: Record<string, number> = {};
	// Specialists that multiply their tile's whole output — a staffed
	// Gardener is +100% to the Grove's yields (Tile.yieldOutputForGovernor
	// applies specialist.aiImprovementClassModifier to iOutput).
	const specialistTileModifier: Record<string, Record<string, number>> = {};
	for (const sp of specialists) {
		if (!sp.zType) continue;
		const flat =
			effectScience(sp.EffectCity).flat +
			effectScience(sp.EffectCityExtra).flat;
		if (flat > 0) specialistScience[sp.zType] = flat / 10;
		const mods: Record<string, number> = {};
		for (const p of pairs(sp.aiImprovementClassModifier)) {
			if (p.zIndex && Number(p.iValue ?? 0) !== 0) {
				mods[p.zIndex] = Number(p.iValue);
			}
		}
		if (Object.keys(mods).length > 0) {
			specialistTileModifier[sp.zType] = mods;
		}
	}

	// Tech → the laws it unlocks: the law CLASS carries the tech prereq
	// (lawClass.xml) and each law names its class (law.xml), so a class's
	// prereq fans out to its law pair (Sovereignty → Tyranny+Constitution).
	const classTech = new Map<string, string>();
	for (const cls of lawClasses) {
		if (cls.zType && cls.TechPrereq) classTech.set(cls.zType, cls.TechPrereq);
	}
	const techLaws: Record<string, string[]> = {};
	for (const law of laws) {
		const tech = law.LawClass ? classTech.get(law.LawClass) : undefined;
		if (!law.zType || !tech) continue;
		(techLaws[tech] ??= []).push(law.zType);
	}
	for (const list of Object.values(techLaws)) list.sort();

	// Unlock costs: each source's unlocking tech resolved to its research
	// cost, so the Science Sources rows can order early-tech → late-tech.
	// Sources with no tech gate (farms, succession laws) stay at 0.
	const techCost = new Map<string, number>();
	for (const t of techs) {
		if (t.zType && t.iCost != null) techCost.set(t.zType, Number(t.iCost));
	}
	const improvementClassTech = new Map<string, string>();
	for (const cls of improvementClasses) {
		if (cls.zType && cls.TechPrereq)
			improvementClassTech.set(cls.zType, cls.TechPrereq);
	}
	const improvementIcon: Record<string, string> = {};
	const improvementUnlockCost: Record<string, number> = {};
	const specialistUnlockCost: Record<string, number> = {};
	for (const imp of improvements) {
		if (!imp.zType) continue;
		if (imp.zIconName && imp.zIconName !== imp.zType) {
			improvementIcon[imp.zType] = imp.zIconName;
		}
		const tech =
			imp.TechPrereq ??
			(imp.Class ? improvementClassTech.get(imp.Class) : undefined);
		const cost = tech ? (techCost.get(tech) ?? 0) : 0;
		if (cost > 0) improvementUnlockCost[imp.zType] = cost;
		// A specialist unlocks with its workplace improvement's tech.
		if (imp.Specialist && cost > 0) {
			specialistUnlockCost[imp.Specialist] = Math.min(
				specialistUnlockCost[imp.Specialist] ?? Infinity,
				cost,
			);
		}
	}
	// Higher tiers of specialists whose workplace is untiered (Elder Officer
	// on the one Barracks) appear on no improvement entry — propagate the
	// cheapest cost across each specialist CLASS so every tier inherits it.
	const specialistClassCost = new Map<string, number>();
	for (const sp of specialists) {
		const cost = sp.zType ? specialistUnlockCost[sp.zType] : undefined;
		if (sp.Class && cost != null) {
			specialistClassCost.set(
				sp.Class,
				Math.min(specialistClassCost.get(sp.Class) ?? Infinity, cost),
			);
		}
	}
	for (const sp of specialists) {
		if (!sp.zType || specialistUnlockCost[sp.zType] != null) continue;
		const cost = sp.Class ? specialistClassCost.get(sp.Class) : undefined;
		if (cost != null) specialistUnlockCost[sp.zType] = cost;
	}
	const lawUnlockCost: Record<string, number> = {};
	for (const law of laws) {
		const tech = law.LawClass ? classTech.get(law.LawClass) : undefined;
		const cost = tech ? (techCost.get(tech) ?? 0) : 0;
		if (law.zType && cost > 0) lawUnlockCost[law.zType] = cost;
	}

	const sorted = <T>(o: Record<string, T>): Record<string, T> =>
		Object.fromEntries(
			Object.keys(o)
				.sort()
				.map((k) => [k, o[k]]),
		);
	// Deterministic AND consistently ordered: inner resource keys too.
	const sortedDeep = (
		o: Record<string, Record<string, number>>,
	): Record<string, Record<string, number>> =>
		Object.fromEntries(
			Object.keys(o)
				.sort()
				.map((k) => [k, sorted(o[k])]),
		);

	const lines: string[] = [];
	lines.push(
		"// AUTO-GENERATED by scripts/bake-science-yields.ts. Do not edit.",
	);
	lines.push(
		"// Run `npm run bake:science-yields` to refresh from Reference/XML.",
	);
	lines.push("");
	lines.push(
		"// Base science of an improvement, in display units: `flat` per turn,",
	);
	lines.push("// `pct` as a percent city-science modifier (libraries).");
	lines.push("export interface ImprovementScience {");
	lines.push("\treadonly flat: number;");
	lines.push("\treadonly pct: number;");
	lines.push("}");
	lines.push("");
	lines.push(
		`export const IMPROVEMENT_SCIENCE: Readonly<Record<string, ImprovementScience>> = ${JSON.stringify(sorted(improvementScience))};`,
	);
	lines.push("");
	lines.push(
		"// Per-resource science of resource-sited improvements (groves earn",
	);
	lines.push("// their science off the luxury they sit on), per turn.");
	lines.push(
		`export const IMPROVEMENT_RESOURCE_SCIENCE: Readonly<Record<string, Readonly<Record<string, number>>>> = ${JSON.stringify(sortedDeep(improvementResourceScience))};`,
	);
	lines.push("");
	lines.push(
		"// Base science of a placed specialist (tier extras included), per turn.",
	);
	lines.push(
		`export const SPECIALIST_SCIENCE: Readonly<Record<string, number>> = ${JSON.stringify(sorted(specialistScience))};`,
	);
	lines.push("");
	lines.push(
		"// Specialist → % modifier applied to their tile's WHOLE output, keyed",
	);
	lines.push(
		"// by the improvement class (a Gardener doubles the Grove's yields:",
	);
	lines.push("// Tile.yieldOutputForGovernor × aiImprovementClassModifier).");
	lines.push(
		`export const SPECIALIST_TILE_MODIFIER: Readonly<Record<string, Readonly<Record<string, number>>>> = ${JSON.stringify(sortedDeep(specialistTileModifier))};`,
	);
	lines.push("");
	lines.push(
		"// ─── Tile modifiers (Tile.yieldModifierNoSpecialist) ────────────────",
	);
	lines.push("");
	lines.push(
		"// Every table below keys by improvement zType OR improvement class,",
	);
	lines.push(
		"// exactly as the XML writes each rule; the two token spaces can't",
	);
	lines.push("// collide, so a lookup sums whichever of the two hit.");
	lines.push("");
	lines.push(
		"// What a NEIGHBOUR grants this tile: granting improvement/class → the",
	);
	lines.push(
		'// improvement/class it lifts → percent. Read as "a Monastery next door',
	);
	lines.push(
		'// is +60% to this Grove" — the game looks the rule up on the neighbour',
	);
	lines.push(
		"// (InfoHelpers.adjacentYieldOutputImprovementModifier), and percentages",
	);
	lines.push("// from several neighbours sum.");
	lines.push(
		`export const IMPROVEMENT_ADJACENT_MODIFIER: Readonly<Record<string, Readonly<Record<string, number>>>> = ${JSON.stringify(sortedDeep(adjacentModifier))};`,
	);
	lines.push("");
	lines.push(
		"// Improvement → science per adjacent resource tile the same team owns",
	);
	lines.push(
		"// (Tile.countTeamAdjacentResources), per turn. Part of the tile's BASE,",
	);
	lines.push("// so the percent modifiers here multiply it.");
	lines.push(
		`export const IMPROVEMENT_ADJACENT_RESOURCE_SCIENCE: Readonly<Record<string, number>> = ${JSON.stringify(sorted(improvementAdjacentResourceScience))};`,
	);
	lines.push("");
	lines.push(
		"// What the CITY grants a tile standing in it (City.getImprovement",
	);
	lines.push(
		"// ModifierForGovernor), by the source a save actually records. Scope",
	);
	lines.push("// differs per table — see each one's comment.");
	lines.push("");
	lines.push("// The city's ruling family class: Clerics double monasteries.");
	lines.push(
		`export const FAMILY_CLASS_IMPROVEMENT_MODIFIER: Readonly<Record<string, Readonly<Record<string, number>>>> = ${JSON.stringify(sortedDeep(familyClassImprovementModifier))};`,
	);
	lines.push("");
	lines.push(
		"// A project the city completed. All are <bSingle>, so the modifier",
	);
	lines.push("// lands once however many completions the city reports.");
	lines.push(
		`export const PROJECT_IMPROVEMENT_MODIFIER: Readonly<Record<string, Readonly<Record<string, number>>>> = ${JSON.stringify(sortedDeep(projectImprovementModifier))};`,
	);
	lines.push("");
	lines.push(
		"// The player's nation, through its player effect — every city of theirs.",
	);
	lines.push(
		`export const NATION_IMPROVEMENT_MODIFIER: Readonly<Record<string, Readonly<Record<string, number>>>> = ${JSON.stringify(sortedDeep(nationImprovementModifier))};`,
	);
	lines.push("");
	lines.push(
		"// A trait on the character GOVERNING the city (<GovernorEffectCity>) —",
	);
	lines.push("// that city only.");
	lines.push(
		`export const GOVERNOR_TRAIT_IMPROVEMENT_MODIFIER: Readonly<Record<string, Readonly<Record<string, number>>>> = ${JSON.stringify(sortedDeep(governorTraitImprovementModifier))};`,
	);
	lines.push("");
	lines.push(
		"// The same trait on the RULER, through <LeaderEffectPlayer> — every",
	);
	lines.push(
		"// city. A Cultivator ruler who also governs gets both, as the game",
	);
	lines.push("// sums the two effects.");
	lines.push(
		`export const LEADER_TRAIT_IMPROVEMENT_MODIFIER: Readonly<Record<string, Readonly<Record<string, number>>>> = ${JSON.stringify(sortedDeep(leaderTraitImprovementModifier))};`,
	);
	lines.push("");
	lines.push(
		"// A wonder that pays a percent of city science only while the city's",
	);
	lines.push(
		"// ruling family is of the right class (<aeEffectCityEffectCity>): the",
	);
	lines.push("// Aksum Stele tiers, +10/25/50% in a Clerics city.");
	lines.push(
		`export const IMPROVEMENT_FAMILY_CLASS_SCIENCE_MODIFIER: Readonly<Record<string, Readonly<Record<string, number>>>> = ${JSON.stringify(sortedDeep(improvementFamilyClassScience))};`,
	);
	lines.push("");
	lines.push(
		"// Improvement → its class, for the science-relevant improvements the",
	);
	lines.push("// tile modifiers above are looked up against.");
	lines.push(
		`export const IMPROVEMENT_CLASS: Readonly<Record<string, string>> = ${JSON.stringify(sorted(improvementClass))};`,
	);
	lines.push("");
	lines.push(
		"// Each pagan shrine's type (War/Fire/Sun/Wisdom/…), from AssetVariation.",
	);
	lines.push(
		`export const SHRINE_TYPE: Readonly<Record<string, string>> = ${JSON.stringify(sorted(shrineType))};`,
	);
	lines.push("");
	lines.push(
		"// Tech → the LAW_* choices it unlocks (law.xml TechPrereq, inverted).",
	);
	lines.push(
		`export const TECH_LAWS: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(sorted(techLaws))};`,
	);
	lines.push("");
	lines.push(
		"// Improvement zType → its 2D icon name (zIconName), where they differ",
	);
	lines.push("// (tiers share a line icon: LIBRARY_2 → IMPROVEMENT_ACADEMY).");
	lines.push(
		`export const IMPROVEMENT_ICON: Readonly<Record<string, string>> = ${JSON.stringify(sorted(improvementIcon))};`,
	);
	lines.push("");
	lines.push(
		"// Research cost of each source's unlocking tech (0 / absent = no tech",
	);
	lines.push(
		"// gate) — orders the Science Sources rows early-tech → late-tech.",
	);
	lines.push(
		`export const IMPROVEMENT_UNLOCK_COST: Readonly<Record<string, number>> = ${JSON.stringify(sorted(improvementUnlockCost))};`,
	);
	lines.push("");
	lines.push(
		`export const SPECIALIST_UNLOCK_COST: Readonly<Record<string, number>> = ${JSON.stringify(sorted(specialistUnlockCost))};`,
	);
	lines.push("");
	lines.push(
		`export const LAW_UNLOCK_COST: Readonly<Record<string, number>> = ${JSON.stringify(sorted(lawUnlockCost))};`,
	);
	lines.push("");
	lines.push(
		"// ─── Court science (InfoHelpers.getRatingYieldRateCourt) ───────────",
	);
	lines.push("");
	lines.push(
		"// Science a court character earns per point of the rating curve, from",
	);
	lines.push(
		"// rating.xml RATING_WISDOM <aiYieldCourtRate>. Emitted RAW (×10 fixed",
	);
	lines.push(
		"// point), unlike the tables above: the curve it feeds is integer math,",
	);
	lines.push("// so callers must divide by 10 only at the end.");
	lines.push(
		`export const WISDOM_COURT_SCIENCE_RATE = ${wisdomCourtScienceRate};`,
	);
	lines.push("");
	lines.push(
		"// yield.xml YIELD_SCIENCE <iTriangleOffset> — the offset the court",
	);
	lines.push("// rating curve (Utils.triangleOffset) is evaluated at.");
	lines.push(
		`export const SCIENCE_TRIANGLE_OFFSET = ${scienceTriangleOffset};`,
	);
	lines.push("");
	lines.push(
		"// globalsInt.xml RATING_EQUIVALENT_LOWER_CHARACTER_YIELDS — under",
	);
	lines.push(
		"// Competitive Mode the court curve is linearized around this rating,",
	);
	lines.push("// so high ratings pay far less than they do normally.");
	lines.push(
		`export const COMPETITIVE_EQUIVALENT_RATING = ${competitiveEquivalentRating};`,
	);
	lines.push("");
	lines.push("// effectPlayer.xml EFFECTPLAYER_COMPETITIVE_MODE <aiYieldRate>");
	lines.push(
		"// YIELD_SCIENCE, per turn: the flat stipend that compensates for the",
	);
	lines.push("// lowered character yields above.");
	lines.push(
		`export const COMPETITIVE_SCIENCE_STIPEND = ${competitiveScienceStipend};`,
	);
	lines.push("");
	lines.push(
		"// ─── Governor / city-effect science (City.cs yield derivation) ──────",
	);
	lines.push("");
	lines.push(
		"// Percent city science per boosted point of the governor's Wisdom",
	);
	lines.push(
		"// (rating.xml <aiYieldGovernorModifier>). RAW percent: multiply by",
	);
	lines.push(
		"// Utils.triangleBoost(wisdom) — or the Competitive linearization",
	);
	lines.push("// around COMPETITIVE_EQUIVALENT_RATING — to get the city's %.");
	lines.push(
		`export const WISDOM_GOVERNOR_SCIENCE_MODIFIER = ${wisdomGovernorScienceModifier};`,
	);
	lines.push("");
	lines.push("// Percent city science PER DISCONTENT LEVEL (yield.xml");
	lines.push(
		"// iNegativeHappinessModifier ×|level| — getHappinessLevelYieldModifier).",
	);
	lines.push("// Negative: an unhappy city genuinely earns less.");
	lines.push(
		`export const SCIENCE_DISCONTENT_MODIFIER = ${scienceDiscontentModifier};`,
	);
	lines.push("");
	lines.push(
		"// Family class → flat science per placed specialist in its cities",
	);
	lines.push(
		"// (effectCity <aiYieldRateSpecialist>, any specialist — Sages).",
	);
	lines.push(
		`export const FAMILY_CLASS_SCIENCE_PER_SPECIALIST: Readonly<Record<string, number>> = ${JSON.stringify(sorted(familyClassSciencePerSpecialist))};`,
	);
	lines.push("");
	lines.push(
		"// Nation → flat science per city from its player effect (Babylonia).",
	);
	lines.push(
		`export const NATION_CITY_SCIENCE: Readonly<Record<string, number>> = ${JSON.stringify(sorted(nationCityScience))};`,
	);
	lines.push("");
	lines.push(
		"// Theology → science per religion present, in each city where a",
	);
	lines.push(
		"// religion holding the theology is present (City.cs ×getReligionCount).",
	);
	lines.push(
		`export const THEOLOGY_SCIENCE_PER_RELIGION: Readonly<Record<string, number>> = ${JSON.stringify(sorted(theologySciencePerReligion))};`,
	);
	lines.push("");
	lines.push(
		"// City project → flat science: `single` effects (bSingle — Archives)",
	);
	lines.push("// pay once regardless of count; the rest multiply (Convoys).");
	lines.push(
		`export const PROJECT_SCIENCE: Readonly<Record<string, { readonly science: number; readonly single: boolean }>> = ${JSON.stringify(sorted(projectScience))};`,
	);
	lines.push("");
	lines.push(
		"// Law → project → flat science per city holding that project, while the",
	);
	lines.push(
		"// law is active (effectCity <aaiEffectCityYieldRate>: Philosophy pays",
	);
	lines.push("// +1 science in every city with a Forum).");
	lines.push(
		`export const LAW_PROJECT_SCIENCE: Readonly<Record<string, Readonly<Record<string, number>>>> = ${JSON.stringify(sortedDeep(lawProjectScience))};`,
	);
	lines.push("");
	lines.push(
		"// Leader archetype trait → project → flat science per city holding that",
	);
	lines.push(
		"// project (the same <aaiEffectCityYieldRate> shape, reached through the",
	);
	lines.push(
		"// trait's <LeaderEffectPlayer>: a Scholar pays +2 per Archive city).",
	);
	lines.push(
		`export const ARCHETYPE_PROJECT_SCIENCE: Readonly<Record<string, Readonly<Record<string, number>>>> = ${JSON.stringify(sortedDeep(archetypeProjectScience))};`,
	);
	lines.push("");
	lines.push(
		"// ─── City damage & assimilation (City.calculateTotalYieldModifier) ──",
	);
	lines.push("");
	lines.push(
		"// Both are percent city-yield modifiers science does not opt out of.",
	);
	lines.push(
		"// Damage is (damage × CITY_DAMAGE_YIELD_MODIFIER) / getHPMax();",
	);
	lines.push(
		"// assimilation is max(-assimilateTurns, CITY_ASSIMILATE_YIELD_MODIFIER).",
	);
	lines.push(
		`export const CITY_DAMAGE_YIELD_MODIFIER = ${cityDamageYieldModifier};`,
	);
	lines.push(
		`export const CITY_ASSIMILATE_YIELD_MODIFIER = ${cityAssimilateYieldModifier};`,
	);
	lines.push("");
	lines.push(
		"// getHPMax() = CITY_HP + the HP the city's own effects add. The save",
	);
	lines.push(
		"// never writes the extra (it is network state only), so the damage",
	);
	lines.push(
		"// denominator is rebuilt from the projects a city reports below.",
	);
	lines.push(`export const CITY_HP_BASE = ${cityHpBase};`);
	lines.push("");
	lines.push(
		"// City project → the max HP its effect adds (effectCity <iCityHP>).",
	);
	lines.push(
		"// All are <bSingle>, so a project pays its HP once however often it",
	);
	lines.push("// was completed.");
	lines.push(
		`export const PROJECT_CITY_HP: Readonly<Record<string, number>> = ${JSON.stringify(sorted(projectCityHp))};`,
	);
	lines.push("");
	lines.push(
		"// ─── Knowledge tiers (Player.calculateKnowledgeOf) ──────────────────",
	);
	lines.push("");
	lines.push(
		"// knowledge.xml in file order. A player's knowledge OF another is",
	);
	lines.push(
		"// bucketed by percent = theirScienceTotal × 100 / ourScienceTotal",
	);
	lines.push(
		"// (integer division): the tier with the smallest percent ≥ that value",
	);
	lines.push(
		"// wins (InfoHelpers.getBestPercentValue); `percent: null` (Erudite) is",
	);
	lines.push("// the catch-all — InfoPercentBase defaults to int.MaxValue.");
	lines.push(
		`export const KNOWLEDGE_TIERS: readonly { readonly type: string; readonly percent: number | null }[] = ${JSON.stringify(knowledgeTiers)};`,
	);
	lines.push("");

	const config = await resolveConfig(OUTPUT_TS);
	const formatted = await prettierFormat(lines.join("\n"), {
		...config,
		parser: "typescript",
		filepath: OUTPUT_TS,
	});
	await mkdir(dirname(OUTPUT_TS), { recursive: true });
	if (existsSync(OUTPUT_TS)) {
		const existing = await readFile(OUTPUT_TS, "utf-8");
		if (existing === formatted) {
			console.log("bake-science-yields: no changes");
			return;
		}
	}
	await writeFile(OUTPUT_TS, formatted);
	console.log(
		`bake-science-yields: ${Object.keys(improvementScience).length} improvements, ${Object.keys(improvementResourceScience).length} resource-sited, ${Object.keys(specialistScience).length} specialists, ${Object.keys(shrineType).length} shrines, ${Object.keys(techLaws).length} law techs → ${OUTPUT_TS.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
