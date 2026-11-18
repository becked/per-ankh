// A draft in words. This is what the question input on /stats/explore shows
// for a selection nobody typed a question for: a link somebody shared, or a
// query composed in the builder.
//
// The sentence is a fixed pattern, "<measure> by <groupings>, where
// <filters>", rather than a question in a person's words. One pattern reads
// acceptably for every source. It is built from the catalog's labels and the
// value names the builder shows, so it describes exactly the selection on
// screen. Sort and row count are left out, because they order and cut the
// rows without changing what is counted.

import { isRangeOp, opLabel, type Draft, type DraftFilter } from "./selection";
import type { CatalogFilter, QueryCatalog } from "./types";
import { valueLabel, vocabularyFor } from "./vocabularies";

// A catalog label as it reads after the first word of a sentence. A label
// that opens on an acronym ("AI Aggression") keeps its capitals.
function midSentence(label: string): string {
	return /^[A-Z]{2}/.test(label)
		? label
		: label.charAt(0).toLowerCase() + label.slice(1);
}

function filterClause(
	filter: DraftFilter,
	spec: CatalogFilter,
	catalog: QueryCatalog,
): string {
	// A vocabulary's name for a value is what the builder's chip shows.
	// valueLabel covers the columns without one: Yes/No for a boolean, the
	// formatted zType for an enum no roster names, and the value itself for
	// text, numbers and dates.
	const vocab = vocabularyFor(spec.vocabulary, catalog.rosters);
	const values = filter.values.map((v) =>
		vocab ? vocab.label(v) : valueLabel(v, spec.type, null, v),
	);
	const op = opLabel(filter.op, spec.type);
	// "played on or after 2026-05-18" reads as it stands. The numeric bounds
	// need a verb: "game length (turns) is at least 100".
	const predicate =
		isRangeOp(filter.op) && spec.type !== "date" ? `is ${op}` : op;
	return `${midSentence(spec.label)} ${predicate} ${values.join(" or ")}`;
}

export function describeDraft(draft: Draft, catalog: QueryCatalog): string {
	const source =
		catalog.sources.find((s) => s.key === draft.source) ?? catalog.sources[0];
	const measure =
		source.measures.find((m) => m.key === draft.measure) ?? source.measures[0];

	const groupings = draft.dimensions.flatMap((key) => {
		const dim = source.dimensions.find((d) => d.key === key);
		return dim ? [midSentence(dim.label)] : [];
	});
	// A row with no values is one still being filled in. canonicalQuery drops
	// it from the URL, so it is not part of the question either.
	const clauses = draft.filters.flatMap((f) => {
		const spec = source.filters.find((s) => s.key === f.key);
		return spec && f.values.length > 0 ? [filterClause(f, spec, catalog)] : [];
	});

	let text = measure.label;
	if (groupings.length > 0) text += ` by ${groupings.join(" and ")}`;
	if (clauses.length > 0) text += `, where ${clauses.join(" and ")}`;
	return text;
}
