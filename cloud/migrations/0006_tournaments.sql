-- Tournament feature: Swiss qualifier → championship bracket.
--
-- Spec reference: docs/archive/tournament-feature-spec.md (goals; implementation
-- details are the plan, not this doc), and the implementation plan at
-- /Users/jeff/.claude/plans/luminous-coalescing-hearth.md.
--
-- Five tables. Material divergences from the spec:
--   * No tournament_registrations table — slots ARE the enrollment.
--     Admin pre-fills tournament_slots.discord_username; user logs in →
--     claim runs in handleDiscordCallback → slot.user_id is set.
--   * No tournament_slot_history table — substitution mutates the slot;
--     the events table captures audit (event_type='tournament_slot_substituted').
--   * No stored swiss_wins/swiss_losses/swiss_status on the slot. All
--     standings are computed on read from tournament_matches. This makes
--     retro-edits a pure UPDATE with no derived-state drift.
--   * Always 2 divisions, named by the admin at create time.

-- ============================================================
-- TOURNAMENTS
-- One row per tournament. Status drives the lifecycle FSM:
--   setup → swiss → championship → complete
-- swiss_advance_count is null during setup; computed and locked when
-- the admin transitions setup → swiss (largest_power_of_2(floor(min(div)/2)),
-- admin-overridable until the transition).
-- allowed_map_scripts is a JSON array of strings (validated non-empty by
-- the create handler); the auto-map-assignment algorithm draws from it.
-- ============================================================

CREATE TABLE tournaments (
    tournament_id TEXT PRIMARY KEY,                       -- nanoid(21)
    slug TEXT NOT NULL UNIQUE,                            -- URL slug, e.g. "ow-open-2026"
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL,                                 -- 'setup'|'swiss'|'championship'|'complete'
    division_a_name TEXT NOT NULL DEFAULT 'Division A',
    division_b_name TEXT NOT NULL DEFAULT 'Division B',
    swiss_advance_count INTEGER,                          -- per-division; null until start-swiss locks it
    swiss_wins_to_advance INTEGER NOT NULL DEFAULT 3,
    swiss_losses_to_eliminate INTEGER NOT NULL DEFAULT 3,
    swiss_max_rounds INTEGER NOT NULL DEFAULT 5,
    allowed_map_scripts TEXT NOT NULL,                    -- JSON array of map_script strings
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))    -- bumped on any mutation; standings/bracket cache key
);

CREATE INDEX idx_tournaments_status ON tournaments(status);

-- ============================================================
-- TOURNAMENT_ADMINS
-- Per-tournament admin role. requireTournamentAdmin() queries this table
-- for every admin mutation. Two write paths:
--   * handleCreateTournament inserts a row for the creator's user_id as
--     part of the create batch (so any signed-in user becomes admin of
--     tournaments they create).
--   * `./per-ankh admin tournament grant-admin` is the only way to add
--     a second admin to an existing tournament.
-- ============================================================

CREATE TABLE tournament_admins (
    tournament_id TEXT NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    granted_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (tournament_id, user_id)
);

CREATE INDEX idx_tournament_admins_user ON tournament_admins(user_id);

-- ============================================================
-- TOURNAMENT_SLOTS
-- Stable bracket positions. A slot's identity persists across player
-- substitutions; only the occupant (discord_username / discord_id / user_id)
-- changes. Swiss W/L is computed by querying tournament_matches against
-- slot_id, so substitution naturally transfers the W/L record.
--
-- Claim flow:
--   1. Admin creates slot with discord_username (lowercased to match
--      auth.ts:385). discord_id and user_id start NULL.
--   2. User logs in → handleDiscordCallback runs a slot-claim UPDATE:
--      first matches by discord_id (handles renames), falls back to
--      discord_username for first-time claims.
--   3. Once claimed, discord_id is pinned (immutable across Discord
--      handle changes). Future logins match by discord_id.
--
-- Substitution clears user_id + discord_id so the new player must re-claim
-- by logging in.
--
-- swiss_seed is a stable display-order tiebreaker within a division (also
-- breaks pairing ties deterministically). championship_seed mirrors the
-- same idea for the bracket phase.
-- ============================================================

CREATE TABLE tournament_slots (
    slot_id TEXT PRIMARY KEY,                             -- nanoid(21)
    tournament_id TEXT NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
    phase TEXT NOT NULL,                                  -- 'swiss'|'championship'
    division TEXT,                                        -- 'A'|'B'|NULL (championship)
    swiss_seed INTEGER,                                   -- display/pair-tiebreak order within division (phase='swiss')
    championship_seed INTEGER,                            -- 1..2N (phase='championship')
    discord_username TEXT,                                -- stored lowercase; admin-set; used for first-time claim
    discord_id TEXT,                                      -- Discord snowflake; pinned on first successful claim
    user_id TEXT REFERENCES users(user_id),               -- NULL = unclaimed/vacant
    claim_banner_dismissed_at TEXT,                       -- set when claimer dismisses the enrollment banner
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (tournament_id, phase, division, swiss_seed),
    UNIQUE (tournament_id, phase, championship_seed)
);

CREATE INDEX idx_slots_tournament ON tournament_slots(tournament_id);
CREATE INDEX idx_slots_user ON tournament_slots(user_id);
CREATE INDEX idx_slots_username ON tournament_slots(discord_username);
CREATE INDEX idx_slots_discord_id ON tournament_slots(discord_id);

-- ============================================================
-- TOURNAMENT_ROUNDS
-- One row per (phase, division, round_number). Status:
--   pending → in_progress → complete
-- "pending" means matches exist but the round hasn't started — admin can
-- still bulk-edit pairings. "in_progress" freezes bulk edits but admin
-- can still substitute pairings on individual pending matches. "complete"
-- freezes everything subject to the retro-edit guard.
--
-- Championship rounds have division=NULL (no divisions in bracket phase).
-- ============================================================

CREATE TABLE tournament_rounds (
    round_id TEXT PRIMARY KEY,                            -- nanoid(21)
    tournament_id TEXT NOT NULL REFERENCES tournaments(tournament_id) ON DELETE CASCADE,
    phase TEXT NOT NULL,                                  -- 'swiss'|'championship'
    division TEXT,                                        -- 'A'|'B'|NULL (championship)
    round_number INTEGER NOT NULL,
    status TEXT NOT NULL,                                 -- 'pending'|'in_progress'|'complete'
    generated_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    UNIQUE (tournament_id, phase, division, round_number)
);

CREATE INDEX idx_rounds_tournament ON tournament_rounds(tournament_id);

-- ============================================================
-- TOURNAMENT_MATCHES
-- One row per match. slot_b_id is nullable to support byes (MVP UX
-- assumes no byes but the schema doesn't block them — algorithm
-- assigns byes when a division has odd active players).
--
-- map_script + pick_order_winner_slot_id are set when the round is
-- generated. map_script auto-assigned from tournament.allowed_map_scripts
-- with anti-repeat preference. pick_order_winner_slot_id defaults to
-- slot_b_id (i.e., the player listed second gets first pick), and is
-- NULL for byes.
--
-- status:
--   pending   — not yet decided
--   complete  — match played and result captured (with or without save).
--               Migration 0010 renamed this from 'reported'.
--   forfeit   — admin-recorded result without play; winner is set
--   bye       — slot_b_id IS NULL; winner_slot_id = slot_a_id
--
-- game_id is the linked save (whichever participant uploaded first via
-- the /games endpoint with tournament_match_id). NULL for forfeit/bye.
-- Concurrent-report safety: the report endpoint includes
-- "WHERE status='pending'" so the second writer gets 0 rows affected
-- and a 409.
-- ============================================================

CREATE TABLE tournament_matches (
    match_id TEXT PRIMARY KEY,                            -- nanoid(21)
    round_id TEXT NOT NULL REFERENCES tournament_rounds(round_id) ON DELETE CASCADE,
    slot_a_id TEXT NOT NULL REFERENCES tournament_slots(slot_id),
    slot_b_id TEXT REFERENCES tournament_slots(slot_id),  -- NULL = bye
    map_script TEXT,
    pick_order_winner_slot_id TEXT REFERENCES tournament_slots(slot_id),  -- NULL for byes
    status TEXT NOT NULL,                                 -- 'pending'|'complete'|'forfeit'|'bye'
    winner_slot_id TEXT REFERENCES tournament_slots(slot_id),
    game_id TEXT REFERENCES games(game_id),               -- the linked save (NULL for forfeit/bye)
    reported_by_user_id TEXT REFERENCES users(user_id),
    reported_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_matches_round ON tournament_matches(round_id);
CREATE INDEX idx_matches_game ON tournament_matches(game_id);
CREATE INDEX idx_matches_slot_a ON tournament_matches(slot_a_id);
CREATE INDEX idx_matches_slot_b ON tournament_matches(slot_b_id);
