Solid, modular plan; address streaming XML, security, ID mapping, and Tauri threading.

Overall assessment

This is a thoughtful, end‑to‑end plan with clear phases, strong transactional discipline, and pragmatic two‑pass parsing for self‑referential entities. The module layout is coherent, and the milestone breakdown is realistic for a 4–6 week MVP-to-polish trajectory. The biggest risks are around XML loading strategy, ID stability across “update-and-replace,” and long‑running work inside a Tauri command.

What’s strong

- Clear phases: Foundation entities → relationships → time‑series keeps foreign keys sane and simplifies error isolation.

- Transactions/savepoints: The all‑or‑nothing model with phase savepoints will prevent partial imports.

- Two‑pass characters: Separating core insert and relationship updates is exactly the right move.

- Sparse time‑series handling: The Tn tag pattern is captured and easy to extend.

- Testing discipline: Unit, integration, and property‑based tests cover correctness and mapper invariants.

- Forward compatibility: Storing enums/constants as strings avoids brittle validation against evolving game values.

Key risks and gaps

- XML loading strategy (DOM vs streaming): quick‑xml is an event/stream parser; a “DOM-like structure” is not native. Building a full in‑memory representation will work at 11–12 MB, but it’s easy to creep past that with complex saves. Prefer streaming readers plus small per‑section structs, or adopt a light DOM like ‎⁠roxmltree⁠ for targeted parts, not the whole file.

- ID mapping for players and others: The plan references ‎⁠id_mapper.get_player()⁠ but the struct example only shows characters/cities/units/tiles. Missing maps/getters for players, tribes, religions, families, technologies, laws, etc. You’ll need a consistent API across all entity types to avoid ad‑hoc lookups.

- Update-and-replace stability: Full delete + re‑insert will change database IDs unless you preserve them. If higher layers or external tools hold references by DB ID, those will break. Consider:

 ▫ Preserving DB IDs per GameId by storing the XML→DB mapping table in the database, reusing on update.

 ▫ Or move to natural keys for lookups (GameId + xml_id + entity_type) and keep DB IDs internal.

- DuckDB savepoints: DuckDB supports savepoints, but ensure the Rust crate’s ‎⁠Transaction⁠ ‎⁠execute("SAVEPOINT ...")⁠ behaves as expected and doesn’t conflict with implicit autocommit. Test this thoroughly; otherwise fall back to sub‑transactions via a single outer transaction and phase‑scoped error handling.

- Long‑running work in Tauri command: The command is ‎⁠async⁠ but performs CPU/IO‑bound work. Use ‎⁠tauri::async_runtime::spawn_blocking⁠ for import to avoid starving the UI thread and enable progress events reliably.

- Zip safety: Handle zip bombs, path traversal (“zip slip”), oversized entries, and multiple XML files deterministically. You already define errors for invalid archives, but add strict limits:

 ▫ Maximum uncompressed XML size.

 ▫ Reject nested directories and normalize entry paths.

 ▫ Ensure only one ‎⁠.xml⁠ entry, or select by a known filename pattern if multiple exist.

- XXE/Entity expansion: quick‑xml doesn’t resolve external entities, which is good, but ensure no custom entity expansion or DTD processing is enabled anywhere. Treat the input as untrusted.

- Concurrency / duplicate imports: Two parallel imports of the same GameId could interleave delete/insert. Add a unique index on ‎⁠matches(game_id)⁠ and acquire an advisory lock or perform ‎⁠SELECT ... FOR UPDATE⁠ on the match row to serialize updates.

- Error provenance: ‎⁠MalformedXML(line_number)⁠ is great; consider adding column offsets when available, and include a short excerpt or element path to speed triage.

- Performance of bulk inserts: Per‑row prepared statements are fine, but DuckDB shines with columnar appends. Consider:

 ▫ Build in‑memory column arrays and use DuckDB’s ‎⁠append⁠ via the Rust bindings if available.

 ▫ Or write CSV/Parquet to a temp file and ‎⁠COPY⁠ into tables for very large histories (only if I/O overhead is acceptable).

Architecture and parser improvements

- Adopt a hybrid parse strategy: Stream the root and dispatch to targeted handlers for each top‑level tag (City, Unit, Character, etc.). For deeply nested sections where random access helps (e.g., big per‑player blobs), use lightweight tree nodes via ‎⁠roxmltree⁠ only for those subtrees.

- Schema-aware deserialization: Define small Rust structs per entity with ‎⁠FromXml⁠-like helpers to centralize attribute/element parsing, defaulting, and sentinel normalization. That reduces repeated ‎⁠.attr()⁠ / ‎⁠.child_text()⁠ boilerplate and mistakes.

- Consistent Option handling: Your examples mix ‎⁠.ok()⁠ and ‎⁠and_then⁠. Standardize with helpers:

 ▫ Required: ‎⁠req_attr<T>("ID")⁠ → error on missing.

 ▫ Optional: ‎⁠opt_child_text<T>("DeathTurn")⁠ → Option    <T>.

 ▫ Sentinel: ‎⁠opt_sent_int("ChosenHeirID", -1)⁠ → Option    <i32>.

- Validation hooks: Add per‑entity ‎⁠validate(&model)⁠ that can log warnings (not errors) for out‑of-range values (negative citizens, invalid turns), enabling a “strict mode” flag later.

DuckDB and database layer

- Foreign key cascades: If you enable ‎⁠ON DELETE CASCADE⁠, you can simplify the reverse‑order delete sequence. Alternatively, keep explicit deletes but generate them from schema metadata to avoid drift.

- Indexes after bulk insert: You note this; implement it. Defer non‑primary indexes until after time‑series inserts complete, then recreate.

- Stable natural keys: Consider a composite unique key ‎⁠(match_id, xml_id, entity_type)⁠ to allow idempotent upserts and maintain referential continuity across updates, even if DB IDs change.

- Store file hash: You compute ‎⁠file_hash⁠ but don’t use it. Store it in ‎⁠matches⁠ and add a ‎⁠match_imports⁠ table to record multiple imports (timestamp, file_hash, rows inserted) for provenance and rollback auditing.

Tauri integration and UX

- Spawn blocking + progress: Run the import in a blocking task and emit granular progress (phase, entity counts, time‑series percent). Your stub shows this—carry it through the pipeline.

- App data dir creation: Ensure the app data directory is created if missing before ‎⁠initialize_schema⁠.

- Error surfacing: Return structured error codes and messages via ‎⁠ImportResult.error⁠, not only strings. The frontend can map codes to user‑friendly guidance.

Security hardening

- Zip intake limits: Enforce a maximum compressed and uncompressed size; reject archives with >N entries or unexpected file types; checksum before parse; randomize temporary extraction names; never trust entry names for filesystem writes.

- Resource exhaustion: Bound the number of entities per section (e.g., max characters, tiles) and bail with a clear error if exceeded.

- Input trust model: Treat all fields as untrusted; avoid string concatenation in SQL (you use params—good); escape/normalize enum strings as needed; avoid panics on parsing.

Testing notes

- Deterministic fixtures: Include a couple of canonical save fixtures covering edge cases: out‑of‑order parents, missing IDs, large sparse histories, and mixed sentinel usage.

- Fuzz the XML: Property tests that generate random but schema‑like fragments will shake out optional field handling, ordering assumptions, and mapper behavior.

- Concurrency tests: Simulate two imports on the same GameId in parallel to verify uniqueness enforcement and transactional integrity.

Milestones realism

- Week 1/2 are feasible: Given the scope, Week 3–5 will slip if you hit unexpected XML diversity. Build adaptable parsers and keep gameplay systems modular so missing sections degrade gracefully.

- Performance target (<15s): Achievable on modern hardware for 11–12 MB saves, but time‑series volume is the swing factor. If you see >30k inserts, move to columnar appends or batched ‎⁠COPY⁠.

Concrete fixes to implement early

- Complete IdMapper API: Add maps/getters for players, families, religions, tribes, and technologies. Define a generic ‎⁠map(entity: EntityType, xml_id)⁠ to reduce duplicated code.

- Choose streaming or partial DOM: Replace “parse XML into DOM-like structure” with a hybrid approach and document the exact crates and modes you’ll use.

- Stabilize IDs across updates: Either persist XML→DB mappings per GameId or adopt natural keys plus upserts to avoid changing DB IDs between imports.

- Threading in Tauri: Run the import in a blocking task; verify progress event throughput; keep the UI responsive.

- Zip guardrails: Implement size limits, single‑file XML selection, and path normalization now.

- Savepoint verification: Write a dedicated test that forces Phase 2 failure and confirms Phase 1 stays committed only after the outer commit, or adjust to a single outer transaction with phase error handling.

If you tighten these areas, the plan should translate into a robust, maintainable importer with solid performance and safety.
