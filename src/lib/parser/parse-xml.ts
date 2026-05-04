// XML parsing config + traversal helpers for the Old World save parser.
//
// fast-xml-parser produces nested plain JS objects. The helpers below mirror
// the roxmltree-based access patterns used in src-tauri/src/parser/.

import { XMLParser } from "fast-xml-parser";
import { ParseError } from "./extract-zip.js";

// Container elements that can repeat as siblings and must always be arrays
// even when a single instance exists. Without this, fast-xml-parser would
// give a single object for one Player and an array for two — every parser
// would need to guard against both shapes.
//
// The isLeafNode predicate below excludes leaf-text elements with the same
// name (e.g. <Religion>RELIGION_BUDDHISM</Religion> as a child of a Tribe is
// a leaf reference, not a top-level Religion container). Without that guard,
// such leaves get wrapped in `[...]` and parsers see strings where they
// expect a single value.
const ALWAYS_ARRAY_TAGS = new Set([
	"Player",
	"Character",
	"Tile",
	"City",
	"Family",
	"Religion",
	"Tribe",
	"Unit",
	"LogData",
	"GoalData",
	"DiplomacyRelation",
	"TraitTurn",
	"RelationshipData",
	"SpouseData",
	"CompletedBuild",
	"BuildQueueEntry",
	"ProjectCount",
	"AgentData",
	"LuxuryData",
	"CityReligion",
	"TeamCulture",
	"TileChange",
	"TileVisibility",
	"UnitPromotion",
	"UnitEffect",
	"UnitFamily",
]);

const xmlParser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	allowBooleanAttributes: true,
	parseAttributeValue: false,
	parseTagValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
	isArray: (name, _jpath, isLeafNode) =>
		!isLeafNode && ALWAYS_ARRAY_TAGS.has(name),
});

/**
 * Parse an Old World save XML string and return the root element's contents
 * (i.e. the children of `<Root>...</Root>`), matching the level the Rust
 * parser sees via `doc.root_element()`.
 */
export function parseSaveXml(xml: string): Record<string, unknown> {
	const parsed = xmlParser.parse(xml) as Record<string, unknown>;
	const elementKeys = Object.keys(parsed).filter((k) => !k.startsWith("?"));
	if (elementKeys.length !== 1) {
		throw new ParseError(
			`Expected single root element, found ${elementKeys.length}: ${elementKeys.join(", ")}`,
			"INVALID_FORMAT",
		);
	}
	const root = parsed[elementKeys[0]];
	if (!isElement(root)) {
		throw new ParseError(
			`Root element ${elementKeys[0]} is not an object`,
			"INVALID_FORMAT",
		);
	}
	return root;
}

/** Coerce a fast-xml-parser value into an array of T, treating undefined as []. */
export function asArray<T>(val: T | T[] | undefined | null): T[] {
	if (val === undefined || val === null) return [];
	return Array.isArray(val) ? val : [val];
}

export function requireStr(val: unknown, path: string): string {
	if (typeof val !== "string" || val === "") {
		throw new ParseError(`Missing required field: ${path}`, "MISSING_FIELD");
	}
	return val;
}

export function requireInt(val: unknown, path: string): number {
	const n = parseInt(String(val), 10);
	if (Number.isNaN(n)) {
		throw new ParseError(`Invalid integer at ${path}: ${String(val)}`, "INVALID_FORMAT");
	}
	return n;
}

export function optStr(val: unknown): string | null {
	return typeof val === "string" && val !== "" ? val : null;
}

export function optInt(val: unknown): number | null {
	if (val === undefined || val === null || val === "") return null;
	const n = parseInt(String(val), 10);
	return Number.isNaN(n) ? null : n;
}

/** True when v is a non-array object (the shape fast-xml-parser uses for elements). */
export function isElement(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Enumerate element children of a node as [tagName, value] pairs, skipping
 * attribute keys (`@_*`) and the `#text` content key. Used for elements with
 * dynamically-named children (e.g. `<FamilyClass><FAMILY_FABIUS>...`).
 */
export function getElementChildren(
	node: Record<string, unknown>,
): Array<[string, unknown]> {
	const out: Array<[string, unknown]> = [];
	for (const [key, value] of Object.entries(node)) {
		if (key.startsWith("@_") || key === "#text") continue;
		out.push([key, value]);
	}
	return out;
}

/**
 * Parse a container whose children are dynamically named with text-integer
 * values, e.g.:
 *
 *   <FamilyHeadID>
 *     <FAMILY_FABIUS>68</FAMILY_FABIUS>
 *     <FAMILY_VALERIUS>95</FAMILY_VALERIUS>
 *   </FamilyHeadID>
 *
 * Returns child name → integer. Children whose text doesn't parse as int are
 * silently skipped (matches the Rust `child.text().and_then(parse).ok()`
 * pattern used in families.rs / religions.rs).
 */
export function parseNameKeyedIntMap(node: unknown): Map<string, number> {
	const out = new Map<string, number>();
	if (!isElement(node)) return out;
	for (const [name, value] of getElementChildren(node)) {
		if (typeof value !== "string") continue;
		const n = parseInt(value, 10);
		if (!Number.isNaN(n)) out.set(name, n);
	}
	return out;
}

/**
 * Depth-first search for the first descendant element with the given tag
 * name, in document order. Mirrors roxmltree's `descendants().find(...)`.
 *
 * Returns the value at that key (string, object, or array per fast-xml-parser
 * conventions), or undefined if no descendant matches.
 */
export function findDescendant(
	node: Record<string, unknown>,
	tagName: string,
): unknown {
	// Direct child first
	if (tagName in node) {
		const direct = node[tagName];
		if (direct !== undefined) return direct;
	}
	// Recurse into element / array children
	for (const [key, value] of Object.entries(node)) {
		if (key.startsWith("@_") || key === "#text") continue;
		if (Array.isArray(value)) {
			for (const item of value) {
				if (isElement(item)) {
					const found = findDescendant(item, tagName);
					if (found !== undefined) return found;
				}
			}
		} else if (isElement(value)) {
			const found = findDescendant(value, tagName);
			if (found !== undefined) return found;
		}
	}
	return undefined;
}
