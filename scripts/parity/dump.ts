// TypeScript-side parity dump CLI.
//
// Counterpart to src-tauri/src/bin/dump_parsed.rs. Imports TS parser modules
// from src/lib/parser/parsers/*.ts (no Worker — runs directly in Node) and
// emits the same envelope shape, but only for entities listed in
// manifest.implemented.
//
// While the implemented list is empty (the typical state at the start of the
// port), this CLI emits the bare metadata envelope and exits 0. The diff
// CLI's per-entity logic correctly classifies un-listed entities as
// `not_ported`, so an empty TS dump is a valid input for `rust-vs-ts`
// runs from day one.
//
// Usage:
//   tsx scripts/parity/dump.ts \
//     --save <save.zip> \
//     --out <ts-dump.json> \
//     --manifest scripts/parity/parity.config.json

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { sha256File } from "./cache.js";
import type { ParityConfig } from "./types.js";
import { extractXmlFromZip } from "../../src/lib/parser/extract-zip.js";
import { parseSaveXml } from "../../src/lib/parser/parse-xml.js";
import {
	parseCharacters,
	type Character,
} from "../../src/lib/parser/parsers/characters.js";
import {
	parseFamilies,
	type Family,
} from "../../src/lib/parser/parsers/families.js";
import {
	parsePlayers,
	type Player,
} from "../../src/lib/parser/parsers/players.js";
import {
	parseReligions,
	type Religion,
} from "../../src/lib/parser/parsers/religions.js";
import {
	parseTribes,
	type Tribe,
} from "../../src/lib/parser/parsers/tribes.js";

const SCHEMA_VERSION = 1;

interface CliArgs {
	save: string;
	out: string;
	manifest: string;
}

function parseArgs(argv: string[]): CliArgs {
	const a = { save: "", out: "", manifest: "" };
	const it = argv[Symbol.iterator]();
	for (let next = it.next(); !next.done; next = it.next()) {
		const arg = next.value;
		const need = (label: string): string => {
			const v = it.next();
			if (v.done) throw new Error(`${label} requires a value`);
			return v.value;
		};
		switch (arg) {
			case "--save":
				a.save = need("--save");
				break;
			case "--out":
				a.out = need("--out");
				break;
			case "--manifest":
				a.manifest = need("--manifest");
				break;
			case "-h":
			case "--help":
				console.error(
					"usage: dump.ts --save <save.zip> --out <ts-dump.json> --manifest <path>",
				);
				process.exit(0);
			default:
				throw new Error(`unknown argument: ${arg}`);
		}
	}
	for (const k of ["save", "out", "manifest"] as const) {
		if (!a[k]) throw new Error(`--${k} is required`);
	}
	return a;
}

/**
 * Registry of (entity key) → (parser function). Each parser takes the
 * unwrapped root element object (children of `<Root>`) and returns an array
 * of plain-JSON rows in snake_case form, matching the Rust serde dump.
 *
 * Per-entity i64 fields that need JSON-string serialization (rather than
 * number) live in I64_STRING_FIELDS below — when porting an entity that has
 * any, the corresponding `toRow` mapper must emit those fields as strings.
 */
type ParserFn = (root: Record<string, unknown>) => Record<string, unknown>[];

const PARSERS: Record<string, ParserFn> = {
	characters: (root) => parseCharacters(root).map(characterToRow),
	families: (root) => parseFamilies(root).map(familyToRow),
	players: (root) => parsePlayers(root).map(playerToRow),
	religions: (root) => parseReligions(root).map(religionToRow),
	tribes: (root) => parseTribes(root).map(tribeToRow),
};

function characterToRow(c: Character): Record<string, unknown> {
	return {
		xml_id: c.xmlId,
		first_name: c.firstName,
		gender: c.gender,
		player_xml_id: c.playerXmlId,
		tribe: c.tribe,
		family: c.family,
		nation: c.nation,
		religion: c.religion,
		birth_turn: c.birthTurn,
		death_turn: c.deathTurn,
		death_reason: c.deathReason,
		birth_father_xml_id: c.birthFatherXmlId,
		birth_mother_xml_id: c.birthMotherXmlId,
		birth_city_xml_id: c.birthCityXmlId,
		cognomen: c.cognomen,
		archetype: c.archetype,
		portrait: c.portrait,
		xp: c.xp,
		level: c.level,
		is_royal: c.isRoyal,
		is_infertile: c.isInfertile,
		became_leader_turn: c.becameLeaderTurn,
		abdicated_turn: c.abdicatedTurn,
		was_religion_head: c.wasReligionHead,
		was_family_head: c.wasFamilyHead,
		nation_joined_turn: c.nationJoinedTurn,
		// seed is i64 in Rust; emit as JSON string when set, null when unset.
		// Per scripts/parity/dump.ts I64_STRING_FIELDS convention.
		seed: c.seed,
	};
}

function familyToRow(f: Family): Record<string, unknown> {
	return {
		family_name: f.familyName,
		family_class: f.familyClass,
		player_xml_id: f.playerXmlId,
		head_character_xml_id: f.headCharacterXmlId,
		seat_city_xml_id: f.seatCityXmlId,
		turns_without_leader: f.turnsWithoutLeader,
	};
}

function playerToRow(p: Player): Record<string, unknown> {
	return {
		xml_id: p.xmlId,
		player_name: p.playerName,
		nation: p.nation,
		dynasty: p.dynasty,
		team_id: p.teamId,
		is_human: p.isHuman,
		is_save_owner: p.isSaveOwner,
		online_id: p.onlineId,
		email: p.email,
		ai_controlled_to_turn: p.aiControlledToTurn,
		difficulty: p.difficulty,
		last_turn_completed: p.lastTurnCompleted,
		turn_ended: p.turnEnded,
		legitimacy: p.legitimacy,
		succession_gender: p.successionGender,
		state_religion: p.stateReligion,
		founder_character_xml_id: p.founderCharacterXmlId,
		chosen_heir_xml_id: p.chosenHeirXmlId,
		original_capital_city_xml_id: p.originalCapitalCityXmlId,
		time_stockpile: p.timeStockpile,
		tech_researching: p.techResearching,
		ambition_delay: p.ambitionDelay,
		tiles_purchased: p.tilesPurchased,
		state_religion_changes: p.stateReligionChanges,
		tribe_mercenaries_hired: p.tribeMercenariesHired,
	};
}

function religionToRow(r: Religion): Record<string, unknown> {
	return {
		religion_name: r.religionName,
		founded_turn: r.foundedTurn,
		founder_player_xml_id: r.founderPlayerXmlId,
		head_character_xml_id: r.headCharacterXmlId,
		holy_city_xml_id: r.holyCityXmlId,
	};
}

function tribeToRow(t: Tribe): Record<string, unknown> {
	return {
		tribe_id: t.tribeId,
		leader_character_xml_id: t.leaderCharacterXmlId,
		allied_player_xml_id: t.alliedPlayerXmlId,
		religion: t.religion,
	};
}

// Reference for parser implementers — fields that must be emitted as JSON
// strings rather than numbers (JS Number cannot safely hold i64).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const I64_STRING_FIELDS: Record<string, readonly string[]> = {
	characters: ["seed"],
	tiles: ["init_seed", "turn_seed"],
	units: ["seed"],
};

/**
 * Inject `dump_index: i` into each row at its array position, mirroring the
 * Rust dump's `rows_with_index` helper. The diff CLI uses this as a
 * tiebreaker when sort keys aren't unique.
 */
function withDumpIndex(
	rows: Record<string, unknown>[],
): Record<string, unknown>[] {
	return rows.map((row, i) => ({ ...row, dump_index: i }));
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const manifestRaw = await readFile(args.manifest, "utf8");
	const manifest = JSON.parse(manifestRaw) as ParityConfig;

	const unimplemented = manifest.implemented.filter((k) => !(k in PARSERS));
	if (unimplemented.length > 0) {
		throw new Error(
			`manifest.implemented lists entities with no registered parser: ${unimplemented.join(", ")}. ` +
				`Add an entry to PARSERS in scripts/parity/dump.ts.`,
		);
	}

	const saveSha = await sha256File(args.save);

	const envelope: Record<string, unknown> = {
		schema_version: SCHEMA_VERSION,
		save_path: args.save,
		save_sha256: saveSha,
	};

	// Skip XML load entirely while no parsers are registered — the empty
	// envelope is a valid input for the diff CLI (every entity becomes
	// not_ported).
	if (manifest.implemented.length > 0) {
		const buf = await readFile(args.save);
		const ab = buf.buffer.slice(
			buf.byteOffset,
			buf.byteOffset + buf.byteLength,
		);
		const xml = extractXmlFromZip(ab);
		const root = parseSaveXml(xml);

		for (const key of manifest.implemented) {
			const parser = PARSERS[key];
			const rows = parser(root);
			envelope[key] = withDumpIndex(rows);
		}
	}

	await mkdir(dirname(args.out), { recursive: true });
	await writeFile(args.out, JSON.stringify(envelope));
}

main().catch((err) => {
	console.error(err instanceof Error ? err.stack ?? err.message : String(err));
	process.exit(1);
});
