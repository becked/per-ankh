// Value rosters and display names for the catalog's enum columns.
//
// The Worker's catalog names a vocabulary; this resolves it. The split is
// where the data already is: the Worker has no name table for a tech or a law,
// and the baked rosters it would have to ship are ones this bundle already
// carries ($lib/generated). So the allowlist stays server-side — a value is
// bound either way, and a token that names nothing selects nothing — and only
// the labels live here.
//
// `options: null` means the vocabulary has a name wrapper but no roster worth
// offering: the builder falls back to a typed token for it. `TECH_NAMES` is
// that case — it is keyed by every tech zType the game ships, the free-unit
// and bonus pseudo-techs included, which is not a list to pick a research
// choice out of.

import { CULTURE_LEVELS, WONDER_CULTURE_PREREQ } from "$lib/generated/wonders";
import { BASE_NATIONS } from "$lib/generated/civilization-colors";
import { LAW_CLASSES } from "$lib/generated/law-classes";
import { LEADER_TRAITS } from "$lib/generated/leader-traits";
import { improvementDisplayName, techName } from "$lib/game-detail/helpers";
import { formatArchetype, formatEnum, nationName } from "$lib/utils/formatting";
import type { ValueType } from "./types";

export interface Vocabulary {
	// The values to offer, or null where there is no roster to offer.
	options: string[] | null;
	label: (value: string) => string;
	// Shown as the placeholder when there is no roster.
	example?: string;
}

// Sorted by the name they display under, not by zType: a picker is read in the
// order it is shown.
const byLabel = (
	values: readonly string[],
	label: (value: string) => string,
): string[] => [...values].sort((a, b) => label(a).localeCompare(label(b)));

const lawLabel = (value: string): string => formatEnum(value, "LAW_");
const cultureLabel = (value: string): string => formatEnum(value, "CULTURE_");

const VOCABULARIES: Readonly<Record<string, Vocabulary>> = {
	nation: { options: byLabel(BASE_NATIONS, nationName), label: nationName },
	// A wonder is an improvement flagged `<bWonder>`, which is what the baked
	// culture-prereq table is keyed by.
	wonder: {
		options: byLabel(
			Object.keys(WONDER_CULTURE_PREREQ),
			improvementDisplayName,
		),
		label: improvementDisplayName,
	},
	law: {
		options: byLabel(
			Object.values(LAW_CLASSES).flatMap((c) => c.laws),
			lawLabel,
		),
		label: lawLabel,
	},
	archetype: {
		options: byLabel(LEADER_TRAITS.archetype, formatArchetype),
		label: formatArchetype,
	},
	// Ascending, as the levels themselves are — the roster's own order is the
	// meaningful one here, so it is not re-sorted by name.
	culture_level: { options: [...CULTURE_LEVELS], label: cultureLabel },
	tech: { options: null, label: techName, example: "TECH_IRONWORKING" },
};

export function vocabularyFor(name: string | undefined): Vocabulary | null {
	return name === undefined ? null : (VOCABULARIES[name] ?? null);
}

/**
 * The label for one value of a column — the game's own name where the column
 * has a vocabulary, the zType formatted where it is a zType without one, and
 * the value itself where the column is free text.
 *
 * A null is the row a question could not name: a seat with no resolved
 * account, a leader whose archetype the save doesn't record, a game with no
 * recorded mode. Those rows are kept rather than dropped, so they need a label
 * that says what they are.
 */
export function valueLabel(
	value: string | number | null,
	type: ValueType | "number",
	vocabulary: string | undefined,
	nullLabel: string,
): string {
	if (value === null) return nullLabel;
	if (type === "boolean") return value === 1 || value === "1" ? "Yes" : "No";
	if (typeof value === "number") return String(value);
	// `text` and `identity` are the columns whose value is somebody's words —
	// a seat's in-save name, an account's display name. Formatting those would
	// cut a name containing an underscore in half.
	if (type !== "enum") return value;
	const vocab = vocabularyFor(vocabulary);
	if (vocab) return vocab.label(value);
	// A zType with no roster: its prefix is its own first token (MAPCLASS_,
	// VICTORY_, FAMILYCLASS_, …), so strip up to the first underscore rather
	// than keeping a list of prefixes in step with the catalog.
	const underscore = value.indexOf("_");
	return underscore === -1
		? value
		: formatEnum(value, value.slice(0, underscore + 1));
}
