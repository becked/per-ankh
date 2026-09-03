// Turn a multi-seat turn-1 save into a solo map by removing every seat after
// the first. A map is usually generated as a hotseat game (a second human is
// the quickest way to get a mirror laid out), and the game has no "remove
// player" button — so the create page does it to the XML. The shape below
// was confirmed against real saves: the root per-player lists are
// positional, <Humans> lists indices, the Game diplomacy maps are keyed by
// team index (team == player on these maps), tiles carry per-team reveal
// entries, and units carry Player=. Only trailing seats can go — nothing is
// renumbered, so the first seat stays index 0.
//
// Browser-only (DOMParser / XMLSerializer); the Worker never transforms a
// save, it stores what the creator uploaded.

const POSITIONAL_LISTS = [
	"Team",
	"Difficulty",
	"Development",
	"Nation",
	"Dynasty",
	"Archetype",
];
const INDEX_LISTS = ["Humans", "StartingPlayerOptions"];

/**
 * The save with the creator's `Email` and `OnlineID` blanked on every seat.
 * The map is a public download, and the game tolerates the empty
 * attributes (an unclaimed hotseat seat is written that way).
 */
export function scrubIdentity(xml: string): string {
	return xml.replace(/<Player\s[^>]*>/g, (tag) =>
		tag.replace(/\b(Email|OnlineID)="[^"]*"/g, '$1=""'),
	);
}

/** The save with every seat but the first removed. Throws when a reference to a removed seat survives — a gap in this transform, never something to ship. */
export function keepFirstSeat(xml: string): string {
	const doc = parse(xml);
	const root = doc.documentElement;
	const seats = childOf(root, "Team").children.length;
	const victims = new Set<string>();
	for (let i = 1; i < seats; i++) victims.add(String(i));
	if (victims.size === 0) return xml;
	const isVictim = (s: string | null | undefined) =>
		s != null && victims.has(s.trim());

	for (const tag of POSITIONAL_LISTS) {
		const list = childOf(root, tag);
		for (const kid of [...list.children].slice(1)) remove(kid);
	}
	for (const tag of INDEX_LISTS) {
		for (const kid of [...childOf(root, tag).children])
			if (isVictim(kid.textContent)) remove(kid);
	}

	// Game-level diplomacy/contact maps: T.<a>.<b> pairs and TRIBE_X.<team>.
	const pair = /^T\.(\d+)\.(\d+)$/;
	const tribe = /^TRIBE_\w+\.(\d+)$/;
	for (const map of [...childOf(root, "Game").children]) {
		for (const kid of [...map.children]) {
			const p = pair.exec(kid.tagName);
			const t = tribe.exec(kid.tagName);
			if ((p && (isVictim(p[1]) || isVictim(p[2]))) || (t && isVictim(t[1])))
				remove(kid);
		}
	}

	for (const player of [...root.children].filter((e) => e.tagName === "Player"))
		if (isVictim(player.getAttribute("ID"))) remove(player);

	// Start sites the surviving seat still owns keep their reservation; the
	// removed seats' become ordinary sites.
	const starting = new Set<string>();
	for (const player of [...root.children].filter((e) => e.tagName === "Player"))
		for (const t of childOf(player, "StartingTileIDs").children)
			starting.add(t.textContent?.trim() ?? "");

	for (const tile of [...root.children].filter((e) => e.tagName === "Tile")) {
		for (const part of [...tile.children]) {
			if (part.tagName.startsWith("Revealed")) {
				for (const team of [...part.children])
					if (isVictim(team.textContent)) remove(team);
				if (part.children.length === 0 && part.tagName !== "RevealedTurn")
					remove(part);
			} else if (
				part.tagName === "Unit" &&
				isVictim(part.getAttribute("Player"))
			) {
				remove(part);
			} else if (
				part.tagName === "CitySite" &&
				(part.textContent === "ACTIVE_START" ||
					part.textContent === "ACTIVE_RESERVED") &&
				!starting.has(tile.getAttribute("ID") ?? "")
			) {
				part.textContent = "ACTIVE";
			}
		}
	}

	const leftover = [...root.getElementsByTagName("*")].filter(
		(e) =>
			isVictim(e.getAttribute("Player")) ||
			((e.tagName === "Player" || e.tagName === "OriginalPlayer") &&
				isVictim(e.textContent)),
	);
	if (leftover.length > 0)
		throw new Error(
			`The save still references a removed seat (${[...new Set(leftover.map((e) => e.tagName))].join(", ")}).`,
		);

	// The game writes a BOM and a declaration; the serializer emits neither.
	return `\uFEFF<?xml version="1.0" encoding="utf-8"?>\n${new XMLSerializer().serializeToString(root)}\n`;
}

function parse(xml: string): XMLDocument {
	const doc = new DOMParser().parseFromString(
		xml.replace(/^\uFEFF/, ""),
		"application/xml",
	);
	const error = doc.getElementsByTagName("parsererror")[0];
	if (error) throw new Error(`Not a readable save: ${error.textContent}`);
	return doc;
}

function childOf(parent: Element, tag: string): Element {
	const el = [...parent.children].find((e) => e.tagName === tag);
	if (!el)
		throw new Error(`The save has no <${tag}> under <${parent.tagName}>.`);
	return el;
}

// Take the indentation before the element with it, so no blank line is left.
function remove(el: Element) {
	const prev = el.previousSibling;
	if (prev?.nodeType === Node.TEXT_NODE && !prev.textContent?.trim())
		prev.remove();
	el.remove();
}
