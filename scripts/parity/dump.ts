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
 * Registry of (entity key) → (parser function). As each TS parser is
 * implemented, add an import and an entry here. The dump CLI iterates
 * `manifest.implemented` and calls the registered function for each entry.
 *
 * Per-entity i64 fields that need JSON-string serialization (rather than
 * number) live in I64_STRING_FIELDS below — the TS parser is expected to
 * emit those fields as strings already, but the table is the canonical
 * spec the parsers must match.
 */
type ParserFn = (xml: unknown) => Record<string, unknown>[];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const PARSERS: Record<string, ParserFn> = {
	// families: (xml) => parseFamilies(xml).map(toRow),
	// Add entries here as parsers come online.
};

// Reference for parser implementers — fields that must be emitted as JSON
// strings rather than numbers (JS Number cannot safely hold i64).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const I64_STRING_FIELDS: Record<string, readonly string[]> = {
	characters: ["seed"],
	tiles: ["init_seed", "turn_seed"],
	units: ["seed"],
};

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

	// XML loading is deferred until at least one parser is registered. While
	// the implemented list is empty, the envelope is metadata-only.
	if (manifest.implemented.length > 0) {
		// TODO: when adding the first parser, load fflate + fast-xml-parser,
		// extract the XML from the zip, parse it, and dispatch through the
		// registry. Until then, this branch is unreachable.
		throw new Error(
			"TS parsing pipeline not yet wired up — the implemented list is non-empty but the XML loader hasn't been hooked up. See dump.ts comments.",
		);
	}

	await mkdir(dirname(args.out), { recursive: true });
	await writeFile(args.out, JSON.stringify(envelope));
}

main().catch((err) => {
	console.error(err instanceof Error ? err.stack ?? err.message : String(err));
	process.exit(1);
});
