// Read one Old World info table the way the game assembles it: the base
// Infos/<stem>.xml, then every campaign/scenario overlay
// Mods/*/Infos/<stem>-{add,change}.xml, collapsed by zType with a per-field
// merge so a -change entry that only touches gameplay fields keeps the
// earlier entry's other values.
//
// Uploaded campaign saves carry the civs, tribes and crests those Mods add, so
// a table baked from Infos/ alone is missing rows a real save names. Each
// merged entry records whether the BASE file defined it: nothing in the XML
// flags campaign content, so the file an entry came from is the only derivable
// split — and it is the one that decides whether an unresolvable entry should
// fail the bake (base = parse drift) or warn (campaign = unaudited content).

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { XMLParser } from "fast-xml-parser";

import { resolveReferenceXml } from "./paths.js";

/** Every info entry is keyed by its `<zType>`; the rest is per-table. */
export interface ReferenceEntry {
	zType?: string;
}

/** A merged entry plus whether `Infos/<stem>.xml` itself defined it. */
export type WithBase<T> = T & { inBase: boolean };

const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
});

/** `<Root><Entry>…</Entry></Root>` → the entries, however many there are. */
export function parseReferenceEntries<T extends ReferenceEntry>(
	xml: string,
): T[] {
	const parsed = parser.parse(xml) as { Root?: { Entry?: T | T[] } };
	const raw = parsed.Root?.Entry;
	return raw == null ? [] : Array.isArray(raw) ? raw : [raw];
}

function definedFields<T extends object>(o: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(o).filter(([, v]) => v !== undefined),
	) as Partial<T>;
}

/**
 * Base + Mods for one info table, keyed by zType. Mods are visited in
 * directory-name order, `-add` before `-change` within each, so the merge is
 * deterministic across machines.
 */
export async function loadMergedEntries<T extends ReferenceEntry>(
	stem: string,
): Promise<Map<string, WithBase<T>>> {
	const xmlDir = resolveReferenceXml();
	const merged = new Map<string, WithBase<T>>();

	const absorb = (entries: T[], inBase: boolean): void => {
		for (const e of entries) {
			if (!e.zType) continue;
			const prev = merged.get(e.zType);
			merged.set(
				e.zType,
				prev == null
					? { ...e, inBase }
					: { ...prev, ...definedFields(e), inBase: prev.inBase || inBase },
			);
		}
	};

	absorb(
		parseReferenceEntries<T>(
			await readFile(resolve(xmlDir, "Infos", `${stem}.xml`), "utf-8"),
		),
		true,
	);
	const modsRoot = resolve(xmlDir, "Mods");
	const mods = (await readdir(modsRoot, { withFileTypes: true }))
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.sort();
	for (const mod of mods) {
		for (const suffix of ["add", "change"]) {
			const path = resolve(modsRoot, mod, "Infos", `${stem}-${suffix}.xml`);
			if (!existsSync(path)) continue;
			absorb(parseReferenceEntries<T>(await readFile(path, "utf-8")), false);
		}
	}
	return merged;
}
