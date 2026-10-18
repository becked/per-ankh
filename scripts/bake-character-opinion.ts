// Bake the coefficients behind a character's opinion of their own leader —
// the rate `Player.calculateCharacterOpinionRate` (PlayerOpinion.cs:1059)
// sums, and the band that rate falls in.
//
// The band is what a unit feels: `Unit.baseStrengthModifier` (Unit.cs:6334)
// adds `player().characterOpinionOfUs(pGeneral).miStrengthModifier` for any
// unit that has a general, −20% to +10%. The save stores no opinion value of
// any kind — `Character.writeGameXML` (Character.cs:832) never writes
// `maiOpinionRate` — so the rate has to be recomputed, and these are the
// numbers it is computed from.
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts), all
// under Reference/XML/Infos/:
//   opinionCharacter.xml — the six bands: <iThreshold> (the band's inclusive
//     upper bound; FRIENDLY omits it) and <iStrengthModifier>.
//   trait.xml            — <iOpinion>, <iOpinionSame>, <aiTraitOpinion>,
//     <aiLawOpinion>, <aiJobOpinion>, plus the three succession flags
//     `isSuccessionEligible` (Character.cs:3047) tests.
//   relationship.xml     — <iOpinion> per relationship.
//   council*.xml         — <iOpinion> per council seat, merged across the
//     file family the way bake-tech-names.ts merges text-*.xml:
//     council-btt.xml (Behind the Throne) adds COUNCIL_GRAND_VIZIER, a
//     fourth seat that job.xml's own <Council> already names.
//   job.xml              — <iOpinion> per job.
//   memory-*.xml         — six tables feeding one MemoryType enum, each entry
//     carrying its own <iValue>/<iTurns> or deferring to a <MemoryLevel>.
//   memoryLevel.xml      — the levels those defer to (`InfoMemory.value` /
//     `.turns`, InfoBase.cs:4267).
//   religion.xml         — <PaganNation>/<PaganNations>/<bNotWorldOrPagan>,
//     which is all `Game.isPaganReligion` / `isWorldReligion` (Game.cs:5662)
//     read.
//   successionGender.xml — <bSingleGender>/<Gender>.
//   effectPlayer.xml     — <aiJobOpinionRate>, reached from a trait's
//     <LeaderEffectPlayer>; the only route from blob state to
//     `Player.getJobOpinionRate` (Player.cs:11021), whose own array is not
//     written to the save either.
//   globalsInt.xml       — the five *_OPINION constants the sum adds flat.
//   globalsType.xml      — GENERAL_JOB, the job `Character.getJob`
//     (Character.cs:9364) returns first for any unit's general.
//
// Band display names are NOT baked: all six of opinionCharacter.xml's
// GenderedName strings resolve to exactly what `formatEnum(zType,
// "OPINIONCHARACTER_")` produces ("Furious", "Angry", "Upset", "Cautious",
// "Pleased", "Friendly"), so per the bake skill's override rule there is no
// override to emit.
//
// OUTPUT: src/lib/generated/character-opinion.ts (checked in, self-contained —
// no .bake sidecar, so bake:finalize never wipes it when this hasn't run).
//
// Run: npm run bake:character-opinion

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";
import { format as prettierFormat, resolveConfig } from "prettier";

import { resolveReferenceXml } from "./lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_TS = resolve(REPO_ROOT, "src/lib/generated/character-opinion.ts");

// The six memory tables all feed one MemoryType enum, so they merge into one
// lookup — `calculateCharacterOpinionMemory` (PlayerOpinion.cs:73) walks the
// player's whole memory list and filters by target character, not by table.
const MEMORY_FILES = [
	"memory-character.xml",
	"memory-eoti.xml",
	"memory-family.xml",
	"memory-player.xml",
	"memory-religion.xml",
	"memory-tribe.xml",
] as const;

// The flat *_OPINION constants `calculateCharacterOpinionRate` adds, keyed by
// the field name the emitted table carries.
const GLOBAL_KEYS: ReadonlyArray<readonly [string, string]> = [
	["leaderSpouse", "LEADER_SPOUSE_OPINION"],
	["heir", "HEIR_OPINION"],
	["parent", "PARENT_OPINION"],
	["leaderReligion", "LEADER_RELIGION_OPINION_CHARACTER"],
	["stateReligion", "STATE_RELIGION_OPINION_CHARACTER"],
];

interface Pair {
	zIndex?: string;
	iValue?: string;
}

interface PairBlock {
	Pair?: Pair | Pair[];
}

interface Entry {
	zType?: string;
	zValue?: string;
	iValue?: string;
	iThreshold?: string;
	iStrengthModifier?: string;
	iOpinion?: string;
	iOpinionSame?: string;
	iTurns?: string;
	aiTraitOpinion?: PairBlock;
	aiLawOpinion?: PairBlock;
	aiJobOpinion?: PairBlock;
	aiJobOpinionRate?: PairBlock;
	bSuccessionReturn?: string;
	bNoSuccession?: string;
	bNoSuccessionChildren?: string;
	bSingleGender?: string;
	Gender?: string;
	Council?: string;
	MemoryLevel?: string;
	LeaderEffectPlayer?: string;
	EffectPlayer?: string;
	PaganNation?: string;
	PaganNations?: { zValue?: string | string[] };
	bNotWorldOrPagan?: string;
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
	const all = Array.isArray(entry) ? entry : [entry];
	// Every info table opens with a schema entry whose zType is empty.
	return all.filter((e) => e.zType != null && e.zType !== "");
}

/** One info table spread over a base file and its DLC siblings. */
async function loadFamily(paths: string[]): Promise<Entry[]> {
	const loaded = await Promise.all(paths.map(loadEntries));
	return loaded.flat();
}

function pairs(block?: PairBlock): Pair[] {
	const p = block?.Pair;
	if (p == null) return [];
	return Array.isArray(p) ? p : [p];
}

/** `<aiFoo>` as a zType → value map, dropping the zeroes the game skips. */
function pairMap(block?: PairBlock): Record<string, number> {
	const out: Record<string, number> = {};
	for (const p of pairs(block)) {
		if (p.zIndex == null || p.zIndex === "") continue;
		const value = Number(p.iValue ?? 0);
		if (value !== 0) out[p.zIndex] = value;
	}
	return out;
}

function num(raw?: string): number {
	return raw != null && raw !== "" ? Number(raw) : 0;
}

function flag(raw?: string): boolean {
	return raw === "1" || raw === "true";
}

/** Sorted object literal, so a re-bake is byte-for-byte reproducible. */
function sortedEntries<T>(map: Record<string, T>): [string, T][] {
	return Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

// ---------- the tables ----------

interface Band {
	type: string;
	threshold: number | null;
	strengthModifier: number;
}

function bands(entries: Entry[]): Band[] {
	const rows = entries.map((e) => ({
		type: e.zType as string,
		// FRIENDLY has no threshold — `miThreshold` stays at int.MaxValue
		// (InfoBase.cs:45), so it wins only when nothing smaller matches.
		threshold: e.iThreshold != null ? Number(e.iThreshold) : null,
		strengthModifier: num(e.iStrengthModifier),
	}));
	if (rows.filter((r) => r.threshold == null).length !== 1) {
		throw new Error(
			"bake-character-opinion: expected exactly one open-ended band " +
				"(the friendliest); the band lookup depends on it.",
		);
	}
	// `getOpinionFromRate` (InfoHelpers.cs:2302) takes the smallest threshold
	// still ≥ the rate, which is ascending-threshold order with the
	// open-ended band last.
	return rows.sort(
		(a, b) => (a.threshold ?? Infinity) - (b.threshold ?? Infinity),
	);
}

interface TraitOpinion {
	opinion?: number;
	opinionSame?: number;
	traitOpinion?: Record<string, number>;
	lawOpinion?: Record<string, number>;
	jobOpinion?: Record<string, number>;
}

function traitOpinions(entries: Entry[]): Record<string, TraitOpinion> {
	const out: Record<string, TraitOpinion> = {};
	for (const e of entries) {
		const row: TraitOpinion = {};
		const opinion = num(e.iOpinion);
		const opinionSame = num(e.iOpinionSame);
		if (opinion !== 0) row.opinion = opinion;
		if (opinionSame !== 0) row.opinionSame = opinionSame;
		const traitOpinion = pairMap(e.aiTraitOpinion);
		const lawOpinion = pairMap(e.aiLawOpinion);
		const jobOpinion = pairMap(e.aiJobOpinion);
		if (Object.keys(traitOpinion).length > 0) row.traitOpinion = traitOpinion;
		if (Object.keys(lawOpinion).length > 0) row.lawOpinion = lawOpinion;
		if (Object.keys(jobOpinion).length > 0) row.jobOpinion = jobOpinion;
		if (Object.keys(row).length > 0) out[e.zType as string] = row;
	}
	return out;
}

/**
 * Per-trait job-opinion RATE, resolved through the trait's
 * `<LeaderEffectPlayer>` and that effect's own `<EffectPlayer>` chain
 * (`changeEffectPlayerCount`, Player.cs:9677, follows it). A leader holding
 * the trait is what puts the count on the player
 * (`Player.setLeader`, Player.cs:11997), and `changeJobOpinionRate`
 * (Player.cs:9629) is what turns the count into the rate.
 */
function jobOpinionRateTraits(
	traits: Entry[],
	effects: Entry[],
): Record<string, Record<string, number>> {
	const effectByType = new Map(effects.map((e) => [e.zType as string, e]));
	const out: Record<string, Record<string, number>> = {};

	for (const trait of traits) {
		const root = trait.LeaderEffectPlayer;
		if (root == null || root === "") continue;

		const totals: Record<string, number> = {};
		const seen = new Set<string>();
		const queue = [root];
		while (queue.length > 0) {
			const type = queue.shift() as string;
			if (seen.has(type)) continue;
			seen.add(type);
			const effect = effectByType.get(type);
			if (effect == null) continue;
			for (const [job, rate] of Object.entries(
				pairMap(effect.aiJobOpinionRate),
			)) {
				totals[job] = (totals[job] ?? 0) + rate;
			}
			if (effect.EffectPlayer != null && effect.EffectPlayer !== "") {
				queue.push(effect.EffectPlayer);
			}
		}
		if (Object.keys(totals).length > 0) out[trait.zType as string] = totals;
	}
	return out;
}

/** COUNCIL_* → the JOB_* that seat is, from job.xml's own `<Council>`. */
function councilJobs(jobs: Entry[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const job of jobs) {
		if (job.Council == null || job.Council === "") continue;
		out[job.Council] = job.zType as string;
	}
	return out;
}

function opinionColumn(entries: Entry[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const e of entries) {
		const value = num(e.iOpinion);
		if (value !== 0) out[e.zType as string] = value;
	}
	return out;
}

interface MemoryOpinion {
	value: number;
	turns: number;
}

function memoryOpinions(
	tables: Entry[][],
	levels: Entry[],
): Record<string, MemoryOpinion> {
	const levelByType = new Map(
		levels.map((l) => [
			l.zType as string,
			{ value: num(l.iValue), turns: num(l.iTurns) },
		]),
	);
	const out: Record<string, MemoryOpinion> = {};
	for (const table of tables) {
		for (const e of table) {
			const level =
				e.MemoryLevel != null ? levelByType.get(e.MemoryLevel) : undefined;
			if (e.MemoryLevel != null && level == null) {
				throw new Error(
					`bake-character-opinion: ${e.zType} names MemoryLevel ${e.MemoryLevel}, which memoryLevel.xml does not define`,
				);
			}
			const value = level?.value ?? num(e.iValue);
			// A zero-value memory can never move a rate — `getAdjustedMemoryValue`
			// (Game.cs:3229) returns 0 for it before anything else.
			if (value === 0) continue;
			out[e.zType as string] = { value, turns: level?.turns ?? num(e.iTurns) };
		}
	}
	return out;
}

type ReligionWorldClass = "pagan" | "world" | "neither";

function religionClasses(entries: Entry[]): Record<string, ReligionWorldClass> {
	const out: Record<string, ReligionWorldClass> = {};
	for (const e of entries) {
		const notWorldOrPagan = flag(e.bNotWorldOrPagan);
		const hasPaganNation =
			(e.PaganNation != null && e.PaganNation !== "") ||
			(e.PaganNations?.zValue != null &&
				(Array.isArray(e.PaganNations.zValue)
					? e.PaganNations.zValue.length > 0
					: e.PaganNations.zValue !== ""));
		// Game.isPaganReligion / isWorldReligion (Game.cs:5662-5669).
		out[e.zType as string] = notWorldOrPagan
			? "neither"
			: hasPaganNation
				? "pagan"
				: "world";
	}
	return out;
}

interface SuccessionGenderRule {
	singleGender: boolean;
	gender: string | null;
}

function successionGenders(
	entries: Entry[],
): Record<string, SuccessionGenderRule> {
	const out: Record<string, SuccessionGenderRule> = {};
	for (const e of entries) {
		out[e.zType as string] = {
			singleGender: flag(e.bSingleGender),
			gender: e.Gender != null && e.Gender !== "" ? e.Gender : null,
		};
	}
	return out;
}

function globalInt(entries: Entry[], zType: string): number {
	const entry = entries.find((e) => e.zType === zType);
	if (entry == null) {
		throw new Error(`bake-character-opinion: globalsInt.xml has no ${zType}`);
	}
	return num(entry.iValue);
}

function globalType(entries: Entry[], zType: string): string {
	const entry = entries.find((e) => e.zType === zType);
	if (entry == null || entry.zValue == null || entry.zValue === "") {
		throw new Error(`bake-character-opinion: globalsType.xml has no ${zType}`);
	}
	return entry.zValue;
}

// ---------- emit ----------

function emit(data: {
	bands: Band[];
	traitOpinion: Record<string, TraitOpinion>;
	jobOpinionRateTraits: Record<string, Record<string, number>>;
	noSuccession: string[];
	successionReturn: string[];
	successionGenders: Record<string, SuccessionGenderRule>;
	relationship: Record<string, number>;
	council: Record<string, number>;
	job: Record<string, number>;
	councilJobs: Record<string, string>;
	memory: Record<string, MemoryOpinion>;
	religionClass: Record<string, ReligionWorldClass>;
	globals: Record<string, number>;
	generalJob: string;
}): string {
	const lines: string[] = [];
	const push = (...rows: string[]) => lines.push(...rows);

	push(
		"// AUTO-GENERATED by scripts/bake-character-opinion.ts. Do not edit.",
		"// Run `npm run bake:character-opinion` to refresh.",
		"//",
		"// The coefficients `Player.calculateCharacterOpinionRate`",
		"// (PlayerOpinion.cs:1059) sums, and the band that rate falls in. Read by",
		"// `$lib/game-detail/character-opinion`, which does the summing.",
		"",
		"export interface OpinionCharacterBand {",
		"\t/** OPINIONCHARACTER_* zType. */",
		"\treadonly type: string;",
		"\t/** Inclusive upper bound on the rate; null on the top band, which is open-ended. */",
		"\treadonly threshold: number | null;",
		"\t/** Percent this band adds to the strength of a unit the character leads. */",
		"\treadonly strengthModifier: number;",
		"}",
		"",
		"// Ascending, which is also resolution order: `getOpinionFromRate`",
		"// (InfoHelpers.cs:2302) takes the smallest threshold still at or above the",
		"// rate, and anything above them all is the last.",
		"export const OPINION_CHARACTER_BANDS: readonly OpinionCharacterBand[] = [",
	);
	for (const band of data.bands) push(`\t${JSON.stringify(band)},`);
	push("];", "");

	push(
		"/** What one trait on the character does to their opinion of the leader. */",
		"export interface TraitOpinion {",
		"\t/** Flat, for a trait the character's own player sees (`:121`). */",
		"\treadonly opinion?: number;",
		"\t/** Flat, when the leader carries the same trait (`:141`). */",
		"\treadonly opinionSame?: number;",
		"\t/** Per trait the LEADER carries (`:166`). */",
		"\treadonly traitOpinion?: Readonly<Record<string, number>>;",
		"\t/** Per law the player has active (`:194`). */",
		"\treadonly lawOpinion?: Readonly<Record<string, number>>;",
		"\t/** Per job the character holds (`:219`). */",
		"\treadonly jobOpinion?: Readonly<Record<string, number>>;",
		"}",
		"",
		"// Only traits that carry at least one of the five columns; everything else",
		"// contributes nothing and falls through at runtime.",
		"export const TRAIT_OPINION: Readonly<Record<string, TraitOpinion>> = {",
	);
	for (const [type, row] of sortedEntries(data.traitOpinion)) {
		push(`\t${JSON.stringify(type)}: ${JSON.stringify(row)},`);
	}
	push("};", "");

	push(
		"// Trait on the LEADER → job → opinion rate it adds to every character",
		"// holding that job, via the trait's <LeaderEffectPlayer>. This is the only",
		"// route from blob state to `Player.getJobOpinionRate` (Player.cs:11021):",
		"// the player's own rate array is not written to the save, and no trait",
		"// grants a council effect player.",
		"export const JOB_OPINION_RATE_TRAITS: Readonly<",
		"\tRecord<string, Readonly<Record<string, number>>>",
		"> = {",
	);
	for (const [type, row] of sortedEntries(data.jobOpinionRateTraits)) {
		push(`\t${JSON.stringify(type)}: ${JSON.stringify(row)},`);
	}
	push("};", "");

	push(
		"// The two trait sets `Character.isSuccessionEligible` (Character.cs:3047)",
		"// tests: one bars a character from the succession outright, the other lets",
		"// a former leader back into it.",
		`export const NO_SUCCESSION_TRAITS: readonly string[] = ${JSON.stringify(data.noSuccession)};`,
		"",
		`export const SUCCESSION_RETURN_TRAITS: readonly string[] = ${JSON.stringify(data.successionReturn)};`,
		"",
		"export interface SuccessionGenderRule {",
		"\t/** When set, only the named gender is eligible at all. */",
		"\treadonly singleGender: boolean;",
		"\t/** GENDER_* zType the rule prefers, or null when it has no preference. */",
		"\treadonly gender: string | null;",
		"}",
		"",
		"export const SUCCESSION_GENDERS: Readonly<",
		"\tRecord<string, SuccessionGenderRule>",
		"> = {",
	);
	for (const [type, row] of sortedEntries(data.successionGenders)) {
		push(`\t${JSON.stringify(type)}: ${JSON.stringify(row)},`);
	}
	push("};", "");

	push(
		"// RELATIONSHIP_* → what holding it toward the leader is worth (`:96`).",
		"export const RELATIONSHIP_OPINION: Readonly<Record<string, number>> = {",
	);
	for (const [type, value] of sortedEntries(data.relationship)) {
		push(`\t${JSON.stringify(type)}: ${value},`);
	}
	push("};", "");

	push(
		"// COUNCIL_* → what sitting in that seat is worth (`:298`).",
		"export const COUNCIL_OPINION: Readonly<Record<string, number>> = {",
	);
	for (const [type, value] of sortedEntries(data.council)) {
		push(`\t${JSON.stringify(type)}: ${value},`);
	}
	push("};", "");

	push(
		"// JOB_* → what holding that job is worth (`:275`), before the rate above.",
		"export const JOB_OPINION: Readonly<Record<string, number>> = {",
	);
	for (const [type, value] of sortedEntries(data.job)) {
		push(`\t${JSON.stringify(type)}: ${value},`);
	}
	push("};", "");

	push(
		"// COUNCIL_* → the JOB_* that seat is. `Character.isJob` (Character.cs:9328)",
		"// resolves a council seat to a job through job.xml's own <Council>, so a",
		"// trait's per-job opinion has to go through this to reach a councillor.",
		"export const COUNCIL_JOBS: Readonly<Record<string, string>> = {",
	);
	for (const [council, job] of sortedEntries(data.councilJobs)) {
		push(`\t${JSON.stringify(council)}: ${JSON.stringify(job)},`);
	}
	push("};", "");

	push(
		"export interface MemoryOpinion {",
		"\t/** Value at the turn the memory was recorded. */",
		"\treadonly value: number;",
		"\t/** Turns it takes to decay to nothing; 0 means it never does. */",
		"\treadonly turns: number;",
		"}",
		"",
		"// MEMORY_* → its undecayed value and window, with the <MemoryLevel>",
		"// indirection (`InfoMemory.value`/`.turns`, InfoBase.cs:4267) already",
		"// resolved. Only memories whose value is non-zero: a zero one can never",
		"// move a rate (`getAdjustedMemoryValue`, Game.cs:3229, returns 0 first).",
		"export const MEMORY_OPINION: Readonly<Record<string, MemoryOpinion>> = {",
	);
	for (const [type, row] of sortedEntries(data.memory)) {
		push(`\t${JSON.stringify(type)}: ${JSON.stringify(row)},`);
	}
	push("};", "");

	push(
		"/** How a religion counts for the two religion terms. */",
		'export type ReligionWorldClass = "pagan" | "world" | "neither";',
		"",
		"// `Game.isPaganReligion` / `isWorldReligion` (Game.cs:5662) read nothing",
		"// but religion.xml, so the classification is a baked fact. Note Atenism",
		"// and Hinduism are pagan by that test, not world religions.",
		"export const RELIGION_WORLD_CLASS: Readonly<",
		"\tRecord<string, ReligionWorldClass>",
		"> = {",
	);
	for (const [type, value] of sortedEntries(data.religionClass)) {
		push(`\t${JSON.stringify(type)}: ${JSON.stringify(value)},`);
	}
	push("};", "");

	push(
		"// The flat *_OPINION globals the sum adds.",
		"export const OPINION_GLOBALS = {",
	);
	for (const [key] of GLOBAL_KEYS) {
		push(`\t${key}: ${data.globals[key]},`);
	}
	push("} as const;", "");

	push(
		"// GENERAL_JOB — the job `Character.getJob` (Character.cs:9364) returns",
		"// first, so it is every unit general's job whatever else they hold.",
		`export const GENERAL_JOB = ${JSON.stringify(data.generalJob)};`,
		"",
	);

	return lines.join("\n");
}

async function main(): Promise<void> {
	const infosDir = resolve(resolveReferenceXml(), "Infos");
	const at = (name: string) => resolve(infosDir, name);

	// Council seats are the one source here with a DLC sibling, and the seat
	// it adds carries an <iOpinion> as real as the base three — so glob the
	// family rather than naming council.xml, which would score a Grand
	// Vizier 0.
	const councilFiles = (await readdir(infosDir))
		.filter((f) => /^council(-[a-z]+)?\.xml$/.test(f))
		.sort()
		.map((f) => resolve(infosDir, f));

	const [
		bandEntries,
		traitEntries,
		relationshipEntries,
		councilEntries,
		jobEntries,
		memoryLevels,
		religionEntries,
		successionGenderEntries,
		effectPlayerEntries,
		globalsInt,
		globalsType,
	] = await Promise.all([
		loadEntries(at("opinionCharacter.xml")),
		loadEntries(at("trait.xml")),
		loadEntries(at("relationship.xml")),
		loadFamily(councilFiles),
		loadEntries(at("job.xml")),
		loadEntries(at("memoryLevel.xml")),
		loadEntries(at("religion.xml")),
		loadEntries(at("successionGender.xml")),
		loadEntries(at("effectPlayer.xml")),
		loadEntries(at("globalsInt.xml")),
		loadEntries(at("globalsType.xml")),
	]);
	const memoryTables = await Promise.all(
		MEMORY_FILES.map((name) => loadEntries(at(name))),
	);

	const globals: Record<string, number> = {};
	for (const [key, zType] of GLOBAL_KEYS) {
		globals[key] = globalInt(globalsInt, zType);
	}

	const data = {
		bands: bands(bandEntries),
		traitOpinion: traitOpinions(traitEntries),
		jobOpinionRateTraits: jobOpinionRateTraits(
			traitEntries,
			effectPlayerEntries,
		),
		noSuccession: traitEntries
			// `hasTraitNoSuccession` (Character.cs:5837) ORs the two columns.
			.filter((t) => flag(t.bNoSuccession) || flag(t.bNoSuccessionChildren))
			.map((t) => t.zType as string)
			.sort(),
		successionReturn: traitEntries
			.filter((t) => flag(t.bSuccessionReturn))
			.map((t) => t.zType as string)
			.sort(),
		successionGenders: successionGenders(successionGenderEntries),
		relationship: opinionColumn(relationshipEntries),
		council: opinionColumn(councilEntries),
		job: opinionColumn(jobEntries),
		councilJobs: councilJobs(jobEntries),
		memory: memoryOpinions(memoryTables, memoryLevels),
		religionClass: religionClasses(religionEntries),
		globals,
		generalJob: globalType(globalsType, "GENERAL_JOB"),
	};

	if (data.bands.length === 0) {
		throw new Error(
			"bake-character-opinion: opinionCharacter.xml produced no bands — did the XML change?",
		);
	}
	if (data.job[data.generalJob] == null) {
		throw new Error(
			`bake-character-opinion: job.xml gives ${data.generalJob} no <iOpinion>; it was 20, and it is the one term every unit general carries`,
		);
	}

	const config = await resolveConfig(OUTPUT_TS);
	const formatted = await prettierFormat(emit(data), {
		...config,
		parser: "typescript",
		filepath: OUTPUT_TS,
	});
	await mkdir(dirname(OUTPUT_TS), { recursive: true });
	if (existsSync(OUTPUT_TS)) {
		const existing = await readFile(OUTPUT_TS, "utf-8");
		if (existing === formatted) {
			console.log("bake-character-opinion: no changes");
			return;
		}
	}
	await writeFile(OUTPUT_TS, formatted);
	console.log(
		`bake-character-opinion: ${data.bands.length} bands, ` +
			`${Object.keys(data.traitOpinion).length} traits, ` +
			`${Object.keys(data.memory).length} memories, ` +
			`${Object.keys(data.relationship).length} relationships → ` +
			OUTPUT_TS.replace(REPO_ROOT + "/", ""),
	);
}

await main();
