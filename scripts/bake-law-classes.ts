// Bake the law → law-class map from the OW reference XML so the stats layer can
// reason about laws by their class — e.g. exclude succession laws (the one class
// flagged bSuccession) from the civic-law charts, and group paired laws by class
// for future class-based charts.
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/lawClass.xml — <Entry> with <zType> (LAWCLASS_*),
//                                       <bSuccession>, <TechPrereq>, <StartingLaw>,
//                                       <bDisabled>.
//   Reference/XML/Infos/law.xml      — <Entry> with <zType> (LAW_*) and <LawClass>
//                                       (the class it belongs to).
//
// OUTPUT: .bake/law-classes.json (gitignored sidecar). The finalize step
// (scripts/build-manifests.ts) reads it and emits the runtime module to BOTH
// src/lib/generated/law-classes.ts (frontend) and cloud/src/generated/
// law-classes.ts (Worker) — same data, both generated, no hand-mirroring.
//
// Reference/ is authoritative (it is the game). Mod-only laws absent from
// Reference/ are out of scope.
//
// Run: npm run bake:law-classes

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";

import { resolveReferenceXml } from "./lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SIDECAR = resolve(REPO_ROOT, ".bake/law-classes.json");

interface LawClassEntry {
	zType?: string;
	bSuccession?: string;
	bDisabled?: string;
	TechPrereq?: string;
	StartingLaw?: string;
}
interface LawEntry {
	zType?: string;
	LawClass?: string;
}

// Emitted per-class shape (mirrored by the generated LawClassInfo interface).
interface LawClassInfo {
	laws: string[];
	succession: boolean;
	techPrereq: string | null;
	startingLaw: string | null;
}

const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
});

async function loadEntries<T>(path: string): Promise<T[]> {
	const xml = await readFile(path, "utf-8");
	const parsed = parser.parse(xml) as { Root?: { Entry?: T | T[] } };
	const entry = parsed.Root?.Entry;
	if (entry == null) return [];
	return Array.isArray(entry) ? entry : [entry];
}

async function main(): Promise<void> {
	const infosDir = resolve(resolveReferenceXml(), "Infos");

	const [classEntries, lawEntries] = await Promise.all([
		loadEntries<LawClassEntry>(resolve(infosDir, "lawClass.xml")),
		loadEntries<LawEntry>(resolve(infosDir, "law.xml")),
	]);

	// Class metadata, keyed by class zType. Skip the empty template entry and
	// any disabled class.
	const meta = new Map<string, LawClassInfo>();
	for (const c of classEntries) {
		if (!c.zType) continue;
		if (c.bDisabled === "1") continue;
		meta.set(c.zType, {
			laws: [],
			succession: c.bSuccession === "1",
			techPrereq: c.TechPrereq ?? null,
			startingLaw: c.StartingLaw ?? null,
		});
	}

	// Attach member laws in law.xml order (stable pole A / pole B / … for charts).
	for (const l of lawEntries) {
		if (!l.zType || !l.LawClass) continue;
		const info = meta.get(l.LawClass);
		if (!info) continue; // class disabled or unknown — skip the law
		info.laws.push(l.zType);
	}

	// Emit only classes that actually have member laws, class keys sorted for
	// deterministic output.
	const classes: Record<string, LawClassInfo> = {};
	for (const key of [...meta.keys()].sort()) {
		const info = meta.get(key)!;
		if (info.laws.length === 0) continue;
		classes[key] = info;
	}

	await mkdir(dirname(SIDECAR), { recursive: true });
	await writeFile(
		SIDECAR,
		JSON.stringify({ classes }, null, "\t") + "\n",
		"utf-8",
	);

	const classCount = Object.keys(classes).length;
	const lawCount = Object.values(classes).reduce(
		(n, c) => n + c.laws.length,
		0,
	);
	const successionCount = Object.values(classes).filter(
		(c) => c.succession,
	).length;
	console.log(
		`bake-law-classes: ${classCount} classes (${successionCount} succession), ` +
			`${lawCount} laws → ${SIDECAR.replace(REPO_ROOT + "/", "")}`,
	);
}

await main();
