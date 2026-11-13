// One compiler: a typed selection in, bound SQL out.
//
// The shape already exists here. `buildAdminGameFilterWhere`
// (cloud/src/games-scope.ts) takes a typed `AdminGameFilter` and returns
// `{ clause, where, binds }` — never a string from its caller. This is that
// generalized: a catalog in place of four hardcoded predicates, and the same
// rule that nothing a caller supplied is ever concatenated into the statement.
// Every literal in the SQL below was written in catalog.ts; every value the
// caller chose is a `?`.
//
// Three bounds compile in here rather than being asked per request:
//
//   * Every selection is an aggregate over a GROUP BY. There is no raw-row
//     projection in the grammar, so no expressible selection returns the whole
//     of `game_player_turn` — the widest thing it can ask for is one row per
//     distinct combination of at most three dimensions.
//   * A row cap, bound rather than interpolated, so the result is bounded even
//     when the grouping isn't.
//   * The corpus. `is_public = 1` is a visibility rule rather than a question,
//     so it is not expressible and not overridable: a private game can never
//     reach an answer. Challenge runs are out for the reason
//     buildGlobalSliceWhere gives — one fixed map replayed to a rule set, so
//     their yields and turn counts describe the challenge rather than how the
//     game is played — which makes this corpus the same one the global stats
//     slices cover.

import { noChallengeRunsSql } from "../games-scope";
import {
	IDENTITY_JOIN_SQL,
	TOURNAMENT_GAME_IDS_SQL,
	dimensionByKey,
	filterByKey,
	measureByKey,
	type CatalogMeasure,
	type QuerySource,
	type ValueType,
} from "./catalog";
import type { QueryFilter, QuerySelection } from "./select";

export interface ResultColumn {
	// The catalog key the client reads this column back under.
	key: string;
	label: string;
	role: "dimension" | "measure" | "key";
	type: ValueType | "number";
	// The SELECT alias. Positional (`d0`, `d0_k0`, `value`) rather than derived
	// from the key, so no catalog key ever reaches the statement as an
	// identifier.
	alias: string;
}

export interface CompiledQuery {
	sql: string;
	binds: (string | number)[];
	columns: ResultColumn[];
}

// What one counted thing is, as SQL. Every one of these leads with
// `g.xml_game_id` except `save`, which is the point: both players uploading one
// match makes two rows in `games`, and three surfaces already collapse them on
// the save's own id (dedupeSeatRecords and the played-games board in stats/,
// the rating model in ratings/duels.ts). A measure that counts matches must
// agree with them; a measure that counts uploads must not.
function countSqlFor(measure: CatalogMeasure, source: QuerySource): string {
	switch (measure.unit) {
		case "match":
			return "COUNT(DISTINCT g.xml_game_id)";
		case "save":
			return "COUNT(DISTINCT g.game_id)";
		case "seat":
			return "COUNT(DISTINCT g.xml_game_id || ':' || ps.player_index)";
		case "event":
			return `COUNT(DISTINCT ${source.eventKeySql})`;
	}
}

function measureSql(measure: CatalogMeasure, source: QuerySource): string {
	if (measure.countSql) return measure.countSql;
	if (measure.agg) return `${measure.agg.fn}(${measure.agg.sql})`;
	return countSqlFor(measure, source);
}

// A value as it is bound. Numbers and booleans go over as numbers rather than
// as the strings the selection carries them in, so a comparison against an
// INTEGER column doesn't rest on SQLite's affinity rules to mean what it says.
function bindValue(type: ValueType, raw: string): string | number {
	return type === "number" || type === "boolean" ? Number(raw) : raw;
}

function compileFilter(
	source: QuerySource,
	filter: QueryFilter,
	binds: (string | number)[],
): string {
	// Resolved rather than trusted: the parse checked the same thing, and a
	// second caller of this module would not have gone through it.
	const spec = filterByKey(source, filter.key);
	if (!spec) throw new Error(`unknown filter ${filter.key}`);

	if (spec.type === "tournament") {
		// The games attached to one tournament's completed matches, read from
		// the one place that defines them (games-scope.ts). `status='complete'`
		// is part of that definition, so a tournament question here covers the
		// same saves that tournament's own stats bundle does.
		const arms = filter.values.map((v) => {
			binds.push(v);
			return `g.game_id IN (${TOURNAMENT_GAME_IDS_SQL})`;
		});
		return arms.length === 1 ? arms[0] : `(${arms.join(" OR ")})`;
	}

	const column = spec.sql;
	if (!column) throw new Error(`filter ${filter.key} has no column`);

	switch (filter.op) {
		case "gte":
		case "lte": {
			binds.push(bindValue(spec.type, filter.values[0]));
			return `${column} ${filter.op === "gte" ? ">=" : "<="} ?`;
		}
		case "in":
		case "not_in": {
			const placeholders = filter.values
				.map((v) => {
					binds.push(bindValue(spec.type, v));
					return "?";
				})
				.join(", ");
			// Plain SQL semantics on the negative form: a row whose value is
			// NULL satisfies neither `IN` nor `NOT IN`, so "nation is not Rome"
			// does not return seats with no recorded nation. Left as SQL reads
			// it rather than widened with an `IS NULL` arm — the alternative is
			// a rule the filter's name doesn't carry — and said plainly in
			// docs/api-reference.md.
			return `${column} ${filter.op === "in" ? "IN" : "NOT IN"} (${placeholders})`;
		}
	}
}

/**
 * Compile a parsed selection into one bound statement, plus the columns the
 * rows come back under.
 *
 * Throws only on a selection that never came through `parseSelection` — every
 * key is resolved against the catalog again here rather than assumed, so a
 * second caller cannot skip the validation by constructing the object itself.
 */
export function compileQuery(
	source: QuerySource,
	selection: QuerySelection,
): CompiledQuery {
	const measure = measureByKey(source, selection.measure);
	if (!measure) throw new Error(`unknown measure ${selection.measure}`);

	const columns: ResultColumn[] = [];
	const selectParts: string[] = [];
	const groupParts: string[] = [];

	let needsPlayer = measure.reach === "player" || measure.unit === "seat";
	let needsIdentity = false;

	selection.dimensions.forEach((key, i) => {
		const dim = dimensionByKey(source, key);
		if (!dim) throw new Error(`unknown dimension ${key}`);
		if (dim.reach === "player") needsPlayer = true;
		if (dim.reach === "identity") {
			needsPlayer = true;
			needsIdentity = true;
		}

		const alias = `d${i}`;
		selectParts.push(`${dim.labelSql ?? dim.sql} AS ${alias}`);
		groupParts.push(dim.sql);
		columns.push({
			key: dim.key,
			label: dim.label,
			role: "dimension",
			type: dim.type,
			alias,
		});

		(dim.keyColumns ?? []).forEach((k, j) => {
			const keyAlias = `${alias}_k${j}`;
			selectParts.push(`${k.sql} AS ${keyAlias}`);
			groupParts.push(k.sql);
			columns.push({
				key: `${dim.key}_${k.suffix}`,
				label: `${dim.label} ${k.suffix}`,
				role: "key",
				type: "text",
				alias: keyAlias,
			});
		});
	});

	const binds: (string | number)[] = [];
	const whereParts = [`g.is_public = 1`, noChallengeRunsSql("g")];
	for (const filter of selection.filters) {
		const spec = filterByKey(source, filter.key);
		if (spec?.reach === "player") needsPlayer = true;
		if (spec?.reach === "identity") {
			needsPlayer = true;
			needsIdentity = true;
		}
		whereParts.push(compileFilter(source, filter, binds));
	}

	selectParts.push(`${measureSql(measure, source)} AS value`);
	columns.push({
		key: "value",
		label: measure.label,
		role: "measure",
		type: "number",
		alias: "value",
	});

	// `player_summaries` is its own join when it isn't already the source.
	const joins: string[] = [];
	if (source.key !== "games") {
		joins.push(`JOIN games g ON g.game_id = ${source.alias}.game_id`);
	}
	if (needsPlayer && source.key !== "player_summaries") {
		joins.push(
			`JOIN player_summaries ps ON ps.game_id = ${source.alias}.game_id
			   AND ps.player_index = ${source.alias}.player_index`,
		);
	}
	// Added only when something in the selection asks who a seat belongs to —
	// two left joins and a correlated NOT EXISTS are not worth paying for on a
	// question that never mentions a player.
	if (needsIdentity) joins.push(IDENTITY_JOIN_SQL);

	const from =
		source.key === "games"
			? "FROM games g"
			: `FROM ${source.table} ${source.alias}`;

	// Deduped: an identity dimension groups on the same expression its first
	// key column selects, and repeating it in the GROUP BY reads as two
	// groupings.
	const groupBy = [...new Set(groupParts)];

	const dimAliases = columns
		.filter((c) => c.role === "dimension")
		.map((c) => c.alias);
	// A tiebreak on the grouping, always: without one, two rows tied on the
	// measure come back in whatever order the scan produced, and the row cap
	// then decides which of them the reader sees.
	const orderBy =
		selection.sort === "dimension_asc"
			? dimAliases.map((a) => `${a} ASC`)
			: [
					`value ${selection.sort === "measure_asc" ? "ASC" : "DESC"}`,
					...dimAliases.map((a) => `${a} ASC`),
				];

	binds.push(selection.limit);

	const sql = [
		`SELECT ${selectParts.join(", ")}`,
		from,
		...joins,
		`WHERE ${whereParts.join(" AND ")}`,
		groupBy.length > 0 ? `GROUP BY ${groupBy.join(", ")}` : "",
		orderBy.length > 0 ? `ORDER BY ${orderBy.join(", ")}` : "",
		"LIMIT ?",
	]
		.filter((part) => part !== "")
		.join("\n");

	return { sql, binds, columns };
}
