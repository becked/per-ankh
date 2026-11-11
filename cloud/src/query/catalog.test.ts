import { describe, expect, it } from "vitest";
import {
	MAX_DIMENSIONS,
	SOURCES,
	serializeCatalog,
	sourceByKey,
	type QuerySource,
} from "./catalog";

// The catalog is the allowlist, so what is guarded here is the properties that
// make it one — not the contents, which are curated and expected to grow.

describe("the catalog's shape", () => {
	it("keys every source uniquely", () => {
		const keys = SOURCES.map((s) => s.key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	for (const source of SOURCES) {
		describe(source.key, () => {
			it("keys its dimensions, measures and filters uniquely", () => {
				for (const list of [
					source.dimensions.map((d) => d.key),
					source.measures.map((m) => m.key),
					source.filters.map((f) => f.key),
				]) {
					expect(new Set(list).size, list.join(",")).toBe(list.length);
				}
			});

			it("offers at least one measure", () => {
				// A source with no measure is a source no selection can name:
				// every selection is an aggregate.
				expect(source.measures.length).toBeGreaterThan(0);
			});

			it("gives every measure a unit note", () => {
				// The note is where a count says whether it deduped a match both
				// players uploaded. A blank one is a number read without it.
				for (const m of source.measures) {
					expect(m.note.length, m.key).toBeGreaterThan(0);
				}
			});

			it("only reaches a seat where it has a player_index", () => {
				const seatish = [
					...source.dimensions.filter(
						(d) => d.reach === "player" || d.reach === "identity",
					),
					...source.measures.filter(
						(m) => m.reach === "player" || m.unit === "seat",
					),
					...source.filters.filter(
						(f) => f.reach === "player" || f.reach === "identity",
					),
				];
				if (!source.joinsPlayer) expect(seatish).toEqual([]);
			});

			it("names its own alias in every source-local expression", () => {
				// A source-local entry written against the wrong alias would
				// compile — SQLite would resolve it against a joined table —
				// and answer a different question.
				const local = [
					...source.dimensions.filter((d) => d.reach === "source"),
					...source.filters.filter((f) => f.reach === "source"),
				];
				for (const entry of local) {
					expect(entry.sql, entry.key).toContain(`${source.alias}.`);
				}
			});

			it("keys an event on the match rather than on the save", () => {
				// Both players uploading one match makes two rows in every one
				// of these tables, so an `event` count that led with game_id
				// would report a tournament's wonders twice over.
				expect(source.eventKeySql).toContain("g.xml_game_id");
				expect(source.eventKeySql).not.toContain("g.game_id");
			});
		});
	}
});

describe("the serialized catalog", () => {
	const wire = serializeCatalog();
	const json = JSON.stringify(wire);

	it("carries no column expressions", () => {
		// The half of every entry that must never leave the Worker. A
		// serializer that spread the entry instead of picking fields would
		// hand a client the schema — and `sql` is also what a future reader
		// would be tempted to trust from the wire.
		expect(json).not.toContain('"sql"');
		expect(json).not.toContain("COALESCE");
		expect(json).not.toContain("SELECT");
		expect(json).not.toContain("user_online_ids");
	});

	it("names no PII column", () => {
		// A source key is a table name by design, so this is about the columns
		// the catalog could have exposed and does not.
		for (const forbidden of ["online_id", "discord_id", "email"]) {
			expect(json, forbidden).not.toContain(forbidden);
		}
	});

	it("covers every source", () => {
		expect(wire.sources.map((s) => s.key)).toEqual(SOURCES.map((s) => s.key));
	});

	it("publishes the bounds a client has to respect", () => {
		expect(wire.limits.max_dimensions).toBe(MAX_DIMENSIONS);
		expect(wire.limits.max_rows).toBeGreaterThan(wire.limits.default_rows);
	});

	it("declares the identity dimension's extra columns", () => {
		const seats = wire.sources.find((s) => s.key === "player_summaries");
		const player = seats?.dimensions.find((d) => d.key === "player");
		expect(player?.key_columns).toEqual(["player_id", "player_slug"]);
	});
});

describe("sourceByKey", () => {
	it("resolves a known source", () => {
		expect(sourceByKey("wonder_events")?.label).toBe("Wonders built");
	});

	it("refuses anything else", () => {
		expect(sourceByKey("games; DROP TABLE games")).toBeNull();
		expect(sourceByKey("")).toBeNull();
	});
});

describe("reachability", () => {
	const games = sourceByKey("games") as QuerySource;

	it("keeps the seat grain out of the games source", () => {
		// Joining games to seats would weight a per-game average by roster
		// size without saying so, which is the whole reason the grain is a
		// property of the source rather than of the question.
		expect(games.dimensions.map((d) => d.key)).not.toContain("nation");
		expect(games.measures.map((m) => m.key)).not.toContain("seats");
	});

	it("gives a seat-grain source the games dimensions too", () => {
		const seats = sourceByKey("player_summaries") as QuerySource;
		expect(seats.dimensions.map((d) => d.key)).toContain("map_class");
		expect(seats.filters.map((f) => f.key)).toContain("tournament");
	});
});
