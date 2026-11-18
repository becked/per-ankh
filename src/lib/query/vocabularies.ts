// Value rosters, display names and icons for the catalog's enum columns.
//
// The Worker's catalog names a vocabulary; this resolves it. The rosters and
// their names are $lib/query/vocabulary-rosters, which the Worker's ask
// endpoint imports too, so the values a picker offers are the values a model
// answer may name. This module adds the pictures, which only the builder
// draws. So the allowlist stays server-side — a value is bound either way, and
// a token that names nothing selects nothing — and the pictures live here.
//
// Two sources, because that is where the data already is. A zType roster is
// baked into this bundle and resolved here. A tournament's name is in D1 and
// nowhere in $lib/generated, so the Worker serves that roster with the catalog
// (`rosters`, cloud/src/query/catalog.ts) and `vocabularyFor` reads it from
// there — the same rule, applied the other way round.
//
// Every vocabulary here carries a roster, and a served one with no entries is
// not a vocabulary at all (vocabularyFor): either way, the builder offers a
// picker where a vocabulary resolves and a typed token where none does.

import { getSpritePath } from "$lib/game-detail/helpers";
import { archetypeSpriteKey, formatEnum } from "$lib/utils/formatting";
import {
	VOCABULARY_ROSTERS,
	type VocabularyRoster,
} from "./vocabulary-rosters";
import type { CatalogRosterOption, ValueType } from "./types";

export interface Vocabulary extends VocabularyRoster {
	// The game's own picture for one value, where the art ships: the sprite for
	// a zType, the account's avatar for a served identity roster. Null for a
	// value inside a vocabulary that has art but not for this one — the bonus
	// and upgrade cards in `tech` are the case — and the whole function is
	// absent from a vocabulary with no art at all, which is what tells a surface
	// whether to reserve room for icons in that column.
	icon?: (value: string) => string | null;
}

// The picture for each vocabulary that has one. A vocabulary absent here has
// no art, and the builder reserves no room for an icon in its column.
const ICONS: Readonly<
	Partial<Record<string, (value: string) => string | null>>
> = {
	nation: (value) => getSpritePath("crests", value),
	// A wonder's 2D icon is the improvement's, which is filed under its
	// zIconName rather than its zType — the indirection getSpritePath applies.
	wonder: (value) => getSpritePath("improvements", value),
	law: (value) => getSpritePath("laws", value),
	// The trimmed-and-squared glyph, which is the copy a tournament match row
	// draws beside a seat (MatchTable) — so an archetype reads the same here
	// as it does there. The key is the trait without its _ARCHETYPE suffix.
	archetype: (value) =>
		getSpritePath("traits-trimmed", archetypeSpriteKey(value)),
	// The four level glyphs ship in the icons set, named by the level itself.
	culture_level: (value) => getSpritePath("icons", value),
	// Null for the bonus and upgrade cards the picker doesn't offer but a
	// grouping still returns — 14 of the 121 values and 347 of the 78,733 rows
	// in the 2026-11-10 snapshot ship no art of their own.
	tech: (value) => getSpritePath("techs", value),
	// The painted portrait rather than the `__ICON` glyph. The glyph is the
	// Military rail's marker, where it replaces a colored dot and 3 of the
	// 91 units ship none; here the box is a value's picture beside its name,
	// which is the slot a crest and an improvement icon fill too, and 90 of
	// the 91 have a portrait.
	unit: (value) => getSpritePath("units", value),
	// A class's crest is filed under the archetype of the same name
	// (FAMILYCLASS_LANDOWNERS → crests/CREST_ARCHETYPE_LANDOWNERS), which is
	// the key the family charts on /stats read it under too.
	family_class: (value) =>
		getSpritePath("crests", value.replace(/^FAMILYCLASS_/, "ARCHETYPE_")),
};

const VOCABULARIES: Readonly<Record<string, Vocabulary>> = Object.fromEntries(
	Object.entries(VOCABULARY_ROSTERS).map(([name, roster]) => {
		const icon = ICONS[name];
		return [name, icon ? { ...roster, icon } : roster];
	}),
);

/** The rosters the Worker served with the catalog, as `QueryCatalog.rosters`. */
export type ServedRosters = Readonly<
	Record<string, readonly CatalogRosterOption[]>
>;

/**
 * The vocabulary a column names, from whichever side holds its values.
 *
 * The baked table wins where there is one, so a `vocabulary` the Worker starts
 * serving a roster for does not silently change which labels a zType column
 * reads under. `served` is only consulted for a name no baked table has.
 */
export function vocabularyFor(
	name: string | undefined,
	served: ServedRosters = {},
): Vocabulary | null {
	if (name === undefined) return null;
	const baked = VOCABULARIES[name];
	if (baked) return baked;
	const roster = served[name];
	// An empty roster is a failed read on the Worker's side — handleQueryCatalog
	// serves the columns with one rather than a 500 — so it resolves to no
	// vocabulary and that filter falls back to the typed token, which is what
	// every one of them took before it had a roster at all.
	if (!roster || roster.length === 0) return null;
	// Order is the Worker's — TOURNAMENT_ROSTER_SQL hands them over newest
	// first, which is the order a tournament picker is read in.
	const byValue = new Map(roster.map((o) => [o.value, o]));
	// Icons only where the Worker sent some. The player roster carries an avatar
	// per account; the tournament roster carries none, and leaving `icon` off
	// there is what keeps a column of tournament names from reserving room for a
	// picture that never arrives.
	const hasIcons = roster.some((o) => o.icon !== undefined);
	return {
		options: roster.map((o) => o.value),
		// A value the roster no longer carries is still the value a shared link
		// asked about, so it labels itself rather than disappearing from the
		// chip that holds it.
		label: (value) => byValue.get(value)?.label ?? value,
		icon: hasIcons ? (value) => byValue.get(value)?.icon ?? null : undefined,
	};
}

/**
 * The label for one value of a column — the game's own name where the column
 * has a vocabulary, the zType formatted where it is a zType without one, and
 * the value itself where the column is free text.
 *
 * A null is the row a question could not name: a leader whose archetype the
 * save doesn't record, a game with no recorded mode. Those rows are kept
 * rather than dropped, so they need a label that says what they are.
 *
 * An identity dimension has no such row — the Worker drops the seats that
 * resolve to no account (PLAYER_USER_ID_SQL, cloud/src/query/catalog.ts) — so
 * `nullLabel` is only ever reached for a value column.
 *
 * Takes the vocabulary already resolved rather than the name of one, because
 * resolving a served roster's vocabulary builds a Map over the whole roster
 * and the answer is the same for every row of a column. The caller resolves
 * one per column.
 */
export function valueLabel(
	value: string | number | null,
	type: ValueType | "number",
	vocab: Vocabulary | null,
	nullLabel: string,
): string {
	if (value === null) return nullLabel;
	if (type === "boolean") return value === 1 || value === "1" ? "Yes" : "No";
	if (typeof value === "number") return String(value);
	// `text` and `identity` are the columns whose value is somebody's words —
	// a seat's in-save name, an account's display name. Formatting those would
	// cut a name containing an underscore in half.
	if (type !== "enum") return value;
	if (vocab) return vocab.label(value);
	// A zType with no roster: its prefix is its own first token
	// (OCCURRENCELEVEL_, …), so strip up to the first underscore rather than
	// keeping a list of prefixes in step with the catalog. Every column this
	// still reaches spells its prefix that way; a column whose values did not —
	// the bare NETWORK and two-word SINGLE_PLAYER the old `games.game_mode`
	// filter offered — is one to give a vocabulary above rather than a case
	// here. It also still catches a value a roster is missing, which is why it
	// is not an exhaustiveness check.
	const underscore = value.indexOf("_");
	return underscore === -1
		? value
		: formatEnum(value, value.slice(0, underscore + 1));
}
