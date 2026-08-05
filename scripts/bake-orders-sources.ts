// Bake the constants the Orders tab needs to itemize orders-per-turn and
// legitimacy, from the OW reference XML — anchored on the game's own
// calculation:
//
//   Orders/turn (Player.calculateNonCityYield) includes, among other terms,
//   `getLegitimacy() × yield.xml ORDERS <iPerLegitimacy>` and every active
//   effectPlayer's <aiYieldRate> ORDERS entry. EffectPlayers are granted by
//   nations (<EffectPlayer>), completed techs (<EffectPlayer>), active laws
//   (<EffectPlayer>) and the ruler's traits/archetype (<LeaderEffectPlayer>).
//   Yield rates are stored ×10 (Constants.YIELDS_MULTIPLIER), so values here
//   are divided down to real orders.
//
//   Legitimacy (Player.getLegitimacy) = an accumulated base — finishing an
//   ambition awards Globals.FINISHED_AMBITION_BONUS's <iLegitimacy> (legacy
//   ambitions the smaller FINISHED_LEGACY_BONUS; events/bonuses this bake
//   can't price) — plus every past-and-present leader's cognomen worth,
//   cognomen.xml <iLegitimacy> divided by reign recency
//   (Character.getLegitimacy: miLegitimacy / (numLeaders − leaderIndex)).
//
// SOURCES (local-only, via the Reference/ symlink resolved by paths.ts):
//   Reference/XML/Infos/{yield,effectPlayer,law,tech,nation,trait,
//   globalsType,bonus,cognomen,difficulty}.xml
//
// OUTPUT: src/lib/generated/orders-sources.ts (checked in, self-contained).
//
// Run: npm run bake:orders-sources

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";
import { format as prettierFormat, resolveConfig } from "prettier";

import { resolveReferenceXml } from "./lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const OUTPUT_TS = resolve(REPO_ROOT, "src/lib/generated/orders-sources.ts");

// Constants.YIELDS_MULTIPLIER — internal yield units per displayed unit.
const YIELDS_MULTIPLIER = 10;

const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
});

interface Entry {
	zType?: string;
	[key: string]: unknown;
}

async function loadEntries(path: string): Promise<Entry[]> {
	const xml = await readFile(path, "utf-8");
	const parsed = parser.parse(xml) as { Root?: { Entry?: Entry | Entry[] } };
	const raw = parsed.Root?.Entry;
	return raw == null ? [] : Array.isArray(raw) ? raw : [raw];
}

// <aiYieldRate><Pair><zIndex>YIELD_X</zIndex><iValue>N</iValue></Pair>…</aiYieldRate>
function yieldRate(entry: Entry, yieldType: string): number {
	const rate = entry.aiYieldRate as
		| {
				Pair?:
					| { zIndex: string; iValue: string }[]
					| { zIndex: string; iValue: string };
		  }
		| undefined;
	if (rate?.Pair == null) return 0;
	const pairs = Array.isArray(rate.Pair) ? rate.Pair : [rate.Pair];
	for (const p of pairs) {
		if (p.zIndex === yieldType) return Number(p.iValue);
	}
	return 0;
}

async function main(): Promise<void> {
	const infosDir = resolve(resolveReferenceXml(), "Infos");
	const load = (f: string) => loadEntries(resolve(infosDir, f));
	const [
		yields,
		effects,
		laws,
		techs,
		nations,
		traits,
		globalsType,
		bonuses,
		cognomens,
		difficulties,
	] = await Promise.all([
		load("yield.xml"),
		load("effectPlayer.xml"),
		load("law.xml"),
		load("tech.xml"),
		load("nation.xml"),
		load("trait.xml"),
		load("globalsType.xml"),
		load("bonus.xml"),
		load("cognomen.xml"),
		load("difficulty.xml"),
	]);

	const ordersYield = yields.find((y) => y.zType === "YIELD_ORDERS");
	if (!ordersYield)
		throw new Error("bake-orders-sources: YIELD_ORDERS missing");
	const perLegitimacy =
		Number(ordersYield.iPerLegitimacy ?? 0) / YIELDS_MULTIPLIER;
	if (perLegitimacy <= 0) {
		throw new Error(
			"bake-orders-sources: ORDERS iPerLegitimacy missing — the legitimacy→orders coupling this tab is built on has changed",
		);
	}

	// effectPlayer → real orders/turn, only where nonzero.
	const effectOrders = new Map<string, number>();
	for (const e of effects) {
		if (!e.zType) continue;
		const v = yieldRate(e, "YIELD_ORDERS");
		if (v !== 0) effectOrders.set(e.zType, v / YIELDS_MULTIPLIER);
	}

	// Source zType → orders/turn via its effectPlayer. Traits use the
	// LEADER effect (active while the character rules), which is the state
	// the blob lets us reconstruct (ruler + their traits at end of game).
	const sourceOrders: Record<string, number> = {};
	const takeFrom = (entries: Entry[], field: string) => {
		for (const e of entries) {
			if (!e.zType) continue;
			const eff = e[field];
			if (typeof eff !== "string" || eff === "") continue;
			const v = effectOrders.get(eff);
			if (v != null && v !== 0) sourceOrders[e.zType] = v;
		}
	};
	takeFrom(laws, "EffectPlayer");
	takeFrom(techs, "EffectPlayer");
	takeFrom(nations, "EffectPlayer");
	takeFrom(traits, "LeaderEffectPlayer");
	// MP players pick their own handicap; game_details.players carries it.
	takeFrom(difficulties, "EffectPlayer");

	// Ambition completions award a flat legitimacy bonus (PlayerGoal.
	// getGoalFinishBonus → Globals.FINISHED_AMBITION_BONUS → bonus.xml
	// iLegitimacy). Legacy ambitions use the smaller legacy bonus; the blob
	// can't tell the two apart, so the tab prices every completion at the
	// ambition value and the remainder line absorbs the difference.
	const bonusFor = (globalType: string): number => {
		const g = globalsType.find((e) => e.zType === globalType);
		const b = bonuses.find((e) => e.zType === (g?.zValue as string));
		return Number(b?.iLegitimacy ?? 0);
	};
	const ambitionLegitimacy = bonusFor("FINISHED_AMBITION_BONUS");
	const legacyAmbitionLegitimacy = bonusFor("FINISHED_LEGACY_BONUS");
	if (ambitionLegitimacy <= 0) {
		throw new Error(
			"bake-orders-sources: FINISHED_AMBITION_BONUS legitimacy missing",
		);
	}

	// Cognomen worth — each ruler's cognomen contributes this, divided by
	// reign recency, to the dynasty's legitimacy.
	const cognomenLegitimacy: Record<string, number> = {};
	for (const c of cognomens) {
		if (!c.zType) continue;
		const v = Number(c.iLegitimacy ?? 0);
		if (v !== 0) cognomenLegitimacy[c.zType] = v;
	}

	if (Object.keys(sourceOrders).length < 5) {
		throw new Error(
			`bake-orders-sources: only ${Object.keys(sourceOrders).length} orders sources parsed`,
		);
	}

	const sorted = (o: Record<string, number>) =>
		Object.fromEntries(
			Object.entries(o).sort(([a], [b]) => a.localeCompare(b)),
		);

	const lines: string[] = [];
	lines.push(
		"// AUTO-GENERATED by scripts/bake-orders-sources.ts. Do not edit.",
	);
	lines.push(
		"// Run `npm run bake:orders-sources` to refresh from Reference/XML.",
	);
	lines.push("");
	lines.push("// Real orders/turn per legitimacy point (yield.xml ORDERS");
	lines.push("// iPerLegitimacy over Constants.YIELDS_MULTIPLIER).");
	lines.push(`export const ORDERS_PER_LEGITIMACY = ${perLegitimacy};`);
	lines.push("");
	lines.push(
		"// Real orders/turn granted while the source is active, keyed by the",
	);
	lines.push(
		"// source's own zType (laws, techs, nations, and ruler traits — the",
	);
	lines.push("// trait values apply while the character holding them rules).");
	lines.push(
		`export const ORDERS_SOURCES: Readonly<Record<string, number>> = ${JSON.stringify(sorted(sourceOrders))};`,
	);
	lines.push("");
	lines.push("// Legitimacy added to the player's base per finished ambition");
	lines.push("// (Globals.FINISHED_AMBITION_BONUS / FINISHED_LEGACY_BONUS).");
	lines.push(`export const AMBITION_LEGITIMACY = ${ambitionLegitimacy};`);
	lines.push(
		`export const LEGACY_AMBITION_LEGITIMACY = ${legacyAmbitionLegitimacy};`,
	);
	lines.push("");
	lines.push(
		"// Each ruler's cognomen contributes this much legitimacy, divided by",
	);
	lines.push(
		"// reign recency (Character.getLegitimacy: value / (numLeaders − index)).",
	);
	lines.push(
		`export const COGNOMEN_LEGITIMACY: Readonly<Record<string, number>> = ${JSON.stringify(sorted(cognomenLegitimacy))};`,
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
			console.log("bake-orders-sources: no changes");
			return;
		}
	}
	await writeFile(OUTPUT_TS, formatted);
	console.log(
		`bake-orders-sources: ${Object.keys(sourceOrders).length} orders sources, ` +
			`ambition +${ambitionLegitimacy} (legacy +${legacyAmbitionLegitimacy}), ` +
			`${Object.keys(cognomenLegitimacy).length} cognomen legitimacy entries → ` +
			OUTPUT_TS.replace(REPO_ROOT + "/", ""),
	);
}

await main();
