// TS-side share-parity dumper. Counterpart to
// `src-tauri/src/bin/dump_shared.rs` — runs the cloud orchestrator
// (`extractAllGameData`) and emits the SharedGameData-overlapping subset
// in the same envelope shape as the Rust desktop's
// `assemble_shared_game_data`.
//
// Constants `version`, `app_version`, `created_at` are normalized to fixed
// values so the diff CLI never sees drift in those fields.
//
// Usage:
//   tsx scripts/parity/share-dump.ts --save <save.zip> --out <ts-dump.json>

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { extractXmlFromZip } from "../../src/lib/parser/extract-zip.js";
import { parseSaveXml } from "../../src/lib/parser/parse-xml.js";
import { extractAllGameData } from "../../src/lib/parser/parsers/index.js";

interface CliArgs {
	save: string;
	out: string;
}

function parseArgs(argv: string[]): CliArgs {
	const a = { save: "", out: "" };
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
			case "-h":
			case "--help":
				console.error("usage: share-dump.ts --save <save.zip> --out <out.json>");
				process.exit(0);
			default:
				throw new Error(`unknown argument: ${arg}`);
		}
	}
	for (const k of ["save", "out"] as const) {
		if (!a[k]) throw new Error(`--${k} is required`);
	}
	return a;
}

const APP_VERSION = "0.0.0-parity";
const FIXED_CREATED_AT = "1970-01-01T00:00:00Z";

/** SharedGameData top-level field set (mirrors Rust src/types.rs:431–449). */
const SHARED_FIELDS = [
	"game_details",
	"player_history",
	"yield_history",
	"event_logs",
	"law_adoption_history",
	"current_laws",
	"tech_discovery_history",
	"completed_techs",
	"units_produced",
	"city_statistics",
	"improvement_data",
	"map_tiles",
	"game_religions",
	"player_wonders",
] as const;

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const buf = await readFile(args.save);
	const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
	const xml = extractXmlFromZip(ab);
	const root = parseSaveXml(xml);
	const data = extractAllGameData(root);

	// Project to the SharedGameData subset. Drop everything else
	// (match_metadata, characters, families, units, etc.); those are
	// FullGameData-only fields that don't have a Rust SharedGameData
	// counterpart to compare against.
	const projected: Record<string, unknown> = {
		// Rust uses `version: u32 = 1` for the legacy share blob; mirror that
		// for the parity output even though FullGameData's `version` is 2.
		version: 1,
		created_at: FIXED_CREATED_AT,
		app_version: APP_VERSION,
	};
	for (const key of SHARED_FIELDS) {
		projected[key] = (data as unknown as Record<string, unknown>)[key];
	}

	await mkdir(dirname(args.out), { recursive: true });
	await writeFile(args.out, JSON.stringify(projected));
}

main().catch((err) => {
	console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
	process.exit(1);
});
