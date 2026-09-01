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
// A <Pair> mapping one type to another rather than to a number.
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
	// project.xml — the one-off Bonus a completed project pays, the umbrella
	// CityProject the blob records the completion under, and the culture level
	// the tier needs.
	Bonus?: string;
	CityProject?: string;
	RequiresCulture?: string;
	// project.xml — the tier below this one on a ladder (Archive II needs I).
	ProjectPrereq?: string;
	// improvement.xml — the religion a religious building belongs to.
	ReligionPrereq?: string;
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
	aiGlobalYields?: { Pair?: YieldPair | YieldPair[] };
	aiYieldOutput?: { Pair?: YieldPair | YieldPair[] };
	aiYieldRate?: { Pair?: YieldPair | YieldPair[] };
	aiYieldModifier?: { Pair?: YieldPair | YieldPair[] };
	aiYieldCourtRate?: { Pair?: YieldPair | YieldPair[] };
	aiYieldGovernorModifier?: { Pair?: YieldPair | YieldPair[] };
	aiYieldRateSpecialist?: { Pair?: YieldPair | YieldPair[] };
	aiYieldRateReligion?: { Pair?: YieldPair | YieldPair[] };
	aiImprovementClassModifier?: { Pair?: YieldPair | YieldPair[] };
	aaiResourceYieldOutput?: { Pair?: ResourceYieldPair | ResourceYieldPair[] };
	// "when effect <zIndex> is present in this city, pay <SubPair>" — the shape
	// Philosophy's Forum science and the Scholar archetype's Archive science use.
	aaiEffectCityYieldRate?: { Pair?: ResourceYieldPair | ResourceYieldPair[] };
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

// Bonus definitions: the base table plus the event bonuses, whose DLC
// variants are hyphenated — the same shape the project files use, and the
// event projects' bonuses live in them.
function isBonusDefFile(name: string): boolean {
	return name === "bonus.xml" || /^bonus-event(-.*)?\.xml$/.test(name);
}

async function loadBonuses(infosDir: string): Promise<Entry[]> {
	const files = (await readdir(infosDir)).filter(isBonusDefFile).sort();
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

// The <Pair> list of a type→type table (<aeTheologyCityEffect>), which maps a
// key type to another type rather than to a number.
function typePairs(block?: { Pair?: TypePair | TypePair[] }): TypePair[] {
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
		bonuses,
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
		loadBonuses(infosDir),
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

	// A theology's science can hang off a BUILDING rather than the theology
	// itself: improvementClass.xml <aeTheologyCityEffect> reads "a building of
	// this class, of a religion that established this theology, puts this
	// effect in the city" (Tile.changeImprovementYieldEffectCity). Gnosticism
	// is the science one — a Temple of a Gnostic religion pays +1 per URBAN
	// specialist in its city — and it is invisible to a sweep of theology.xml,
	// which carries no YIELD_SCIENCE at all.
	const theologyBuildingSciencePerUrbanSpecialist: Record<
		string,
		Record<string, number>
	> = {};
	for (const cls of improvementClasses) {
		if (!cls.zType) continue;
		for (const pair of typePairs(cls.aeTheologyCityEffect)) {
			if (!pair.zIndex || !pair.zValue) continue;
			const e = effectByType.get(pair.zValue);
			if (!e) continue;
			const v = yieldValue(
				pairs(e.aiYieldRateSpecialistUrban),
				"YIELD_SCIENCE",
			);
			if (v > 0) {
				(theologyBuildingSciencePerUrbanSpecialist[pair.zIndex] ??= {})[
					cls.zType
				] = v / 10;
			}
		}
	}

	// The religion a building of one of those classes belongs to, so a city's
	// Temple can be matched against the theologies its religion established.
	// Only the classes the table above names, which keeps this to the handful
	// of religious buildings that can pay science.
	const theologyClasses = new Set(
		Object.values(theologyBuildingSciencePerUrbanSpecialist).flatMap(
			(byClass) => Object.keys(byClass),
		),
	);
	const improvementReligion: Record<
		string,
		{ religion: string; class: string }
	> = {};
	for (const imp of improvements) {
		if (!imp.zType || !imp.ReligionPrereq || !imp.Class) continue;
		if (!theologyClasses.has(imp.Class)) continue;
		// Carries its own class: a Temple pays no science of its own, so it is
		// not in IMPROVEMENT_CLASS and the lookup would otherwise miss it.
		improvementReligion[imp.zType] = {
			religion: imp.ReligionPrereq,
			class: imp.Class,
		};
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

	// ─── One-off project science (Inquiries) ─────────────────────────────
	//
	// A few projects pay a LUMP of science on completion rather than a rate:
	// project.xml <Bonus> → bonus.xml <aiGlobalYields> YIELD_SCIENCE, paid
	// through Player.processYieldWhole (Player.cs:17199), which multiplies by
	// YIELDS_MULTIPLIER — so unlike every other value in this file these are
	// already WHOLE science and are NOT divided by 10.
	//
	// The Inquiry line is the one that matters: four repeatable tiers, each
	// gated on the city's culture level and worth 40/80/120/160. A save
	// records completions under the hidden umbrella <CityProject>
	// (PROJECT_INQUIRY) with no tier and no turn, so the table keys by that
	// umbrella and carries each tier's culture gate — enough to bound what a
	// city's completions were worth.
	const bonusScience = new Map<string, number>();
	for (const b of bonuses) {
		if (!b.zType) continue;
		const science = yieldValue(pairs(b.aiGlobalYields), "YIELD_SCIENCE");
		if (science > 0) bonusScience.set(b.zType, science);
	}
	const projectByType = new Map(
		projects.filter((p) => p.zType != null).map((p) => [p.zType as string, p]),
	);
	// What one recorded completion is WORTH, which is not always what the tier
	// itself pays. A ladder (Archive II needs I, III needs II) leaves only its
	// highest rung in the save: City.finishProject zeroes the count of every
	// project the finished one invalidates (City.cs), and <abInvalidBy> on the
	// Archive line lists every higher tier. So a city recorded at Archive III
	// built I and II on the way and was paid for all three — 10 + 20 + 30.
	// Walking <ProjectPrereq> back down the ladder recovers that.
	const cumulativeScience = (
		zType: string,
		seen = new Set<string>(),
	): number => {
		if (seen.has(zType)) return 0;
		seen.add(zType);
		const p = projectByType.get(zType);
		if (!p?.Bonus) return 0;
		const own = bonusScience.get(p.Bonus) ?? 0;
		return (
			own + (p.ProjectPrereq ? cumulativeScience(p.ProjectPrereq, seen) : 0)
		);
	};
	const projectOneOffScience: Record<
		string,
		{ project: string; science: number; culture: string | null }[]
	> = {};
	for (const p of projects) {
		if (!p.zType || !p.Bonus) continue;
		if (bonusScience.get(p.Bonus) == null) continue;
		// Completions are recorded under the umbrella project when there is
		// one, and under the project itself when there isn't.
		const key = p.CityProject ?? p.zType;
		(projectOneOffScience[key] ??= []).push({
			project: p.zType,
			science: cumulativeScience(p.zType),
			culture: p.RequiresCulture ?? null,
		});
	}
	for (const tiers of Object.values(projectOneOffScience)) {
		tiers.sort(
			(a, b) => a.science - b.science || a.project.localeCompare(b.project),
		);
	}
	if (projectOneOffScience["PROJECT_INQUIRY"] == null) {
		throw new Error(
			"bake-science-yields: no one-off science found for PROJECT_INQUIRY — the project/bonus shape changed",
		);
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
		"// Theology → improvement class → science per URBAN specialist, paid in",
	);
	lines.push(
		"// every city holding a building of that class whose religion established",
	);
	lines.push(
		"// the theology (Gnosticism's Temples). The theology entry itself carries",
	);
	lines.push("// no science — the rule lives on the improvement class.");
	lines.push(
		`export const THEOLOGY_BUILDING_SCIENCE_PER_URBAN_SPECIALIST: Readonly<Record<string, Readonly<Record<string, number>>>> = ${JSON.stringify(sortedDeep(theologyBuildingSciencePerUrbanSpecialist))};`,
	);
	lines.push("");
	lines.push(
		"// Religious building → the religion it belongs to (<ReligionPrereq>),",
	);
	lines.push(
		"// for the classes the theology table above names. Lets a city's Temple",
	);
	lines.push("// be matched against the theologies its religion established.");
	lines.push(
		`export const IMPROVEMENT_RELIGION: Readonly<Record<string, { readonly religion: string; readonly class: string }>> = ${JSON.stringify(sorted(improvementReligion as unknown as Record<string, unknown>))};`,
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
		"// City project → the tiers that pay a ONE-OFF lump of science when",
	);
	lines.push(
		"// completed, cheapest first. Keyed by the umbrella <CityProject> the",
	);
	lines.push(
		"// save records completions under (PROJECT_INQUIRY), because a blob",
	);
	lines.push(
		"// carries neither the tier nor the turn — only how many a city ran.",
	);
	lines.push(
		"// `culture` is the tier's RequiresCulture gate, which bounds what a",
	);
	lines.push(
		"// given city's completions can have been worth. `science` is CUMULATIVE",
	);
	lines.push(
		"// down a prereq ladder — an Archive III city was paid for I and II on",
	);
	lines.push(
		"// the way up, and the save keeps only the highest rung (abInvalidBy).",
	);
	lines.push(
		"// given city's completions can have been worth. Values are WHOLE",
	);
	lines.push(
		"// science, not the file's usual ÷10 (Player.processYieldWhole).",
	);
	lines.push(
		`export const PROJECT_ONE_OFF_SCIENCE: Readonly<Record<string, readonly { readonly project: string; readonly science: number; readonly culture: string | null }[]>> = ${JSON.stringify(sorted(projectOneOffScience as unknown as Record<string, unknown>))};`,
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
