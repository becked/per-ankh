-- Enforce: swiss-phase slots always have a non-null swiss_seed.
-- Championship slots still have NULL swiss_seed (championship_seed is
-- their ordering). Today no code path writes NULL for swiss-phase slots
-- (bulkCreateSlots auto-assigns via nextSeedByDiv; PatchSlotSchema has
-- no nullable path), so this migration formalises an existing invariant
-- and removes the untested `swiss_seed ?? 0` fallback branch in
-- compareForPairing.
--
-- Implemented as triggers rather than ALTER TABLE ADD CHECK because
-- SQLite doesn't support adding constraints to existing columns. The
-- alternative — create-new-table / copy / drop / rename — would require
-- toggling PRAGMA foreign_keys to handle the four tournament_matches FK
-- references back into tournament_slots, which is more failure-prone
-- than triggers and offers no real upside given the very low write rate
-- on this table.

CREATE TRIGGER swiss_seed_required_on_insert
BEFORE INSERT ON tournament_slots
WHEN NEW.phase = 'swiss' AND NEW.swiss_seed IS NULL
BEGIN
    SELECT RAISE(FAIL, 'swiss_seed required for swiss-phase slots');
END;

CREATE TRIGGER swiss_seed_required_on_update
BEFORE UPDATE OF swiss_seed, phase ON tournament_slots
WHEN NEW.phase = 'swiss' AND NEW.swiss_seed IS NULL
BEGIN
    SELECT RAISE(FAIL, 'swiss_seed required for swiss-phase slots');
END;
