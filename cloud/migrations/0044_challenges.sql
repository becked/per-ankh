-- Challenge maps (docs/challenge-maps-design.md §6): a turn-1 save one player
-- publishes and everyone else plays, auto-scored from their uploaded run.

-- ============================================================
-- CHALLENGES
-- One row per published map. `number` continues the community's Discord-era
-- numbering (#1–#26 were run by hand) — allocated MAX(number)+1 from
-- FIRST_CHALLENGE_NUMBER at insert. The rules are JSON: `setup` is what the
-- map fixes for every run (GameId, seat, nation, leader, options — the
-- ChallengeSetup shape in src/lib/challenges/types.ts), `objectives` and
-- `criteria` the scored lists.
-- Objectives/criteria lock once a submission exists (the leaderboard would
-- otherwise rank runs scored against different rules).
-- ============================================================
CREATE TABLE challenges (
    challenge_id TEXT PRIMARY KEY,                        -- nanoid(21)
    number INTEGER NOT NULL UNIQUE,                       -- public "#27"
    title TEXT NOT NULL,
    description TEXT,
    created_by TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    closes_at TEXT NOT NULL,                              -- submissions refused after this
    setup TEXT NOT NULL,                                  -- JSON ChallengeSetup
    objectives TEXT NOT NULL,                             -- JSON Objective[]
    criteria TEXT NOT NULL,                               -- JSON Criterion[]
    map_r2_key TEXT NOT NULL,                             -- challenges/{challenge_id}/map.zip
    map_file_hash TEXT NOT NULL,                          -- sha256 of the ZIP
    map_size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_challenges_closes_at ON challenges(closes_at);
CREATE INDEX idx_challenges_created_by ON challenges(created_by);

-- ============================================================
-- CHALLENGE_SUBMISSIONS
-- One row per accepted run. The game row is the upload (a normal games row,
-- forced public, in the user's "Challenge #N" collection); deleting the game
-- withdraws the run, deleting the challenge drops its runs' links (the games
-- stay in their owners' libraries). `verdict` is the scorer's output as
-- persisted at upload — authoritative, never recomputed on render.
-- ============================================================
CREATE TABLE challenge_submissions (
    submission_id TEXT PRIMARY KEY,                       -- nanoid(21)
    challenge_id TEXT NOT NULL REFERENCES challenges(challenge_id) ON DELETE CASCADE,
    game_id TEXT NOT NULL UNIQUE REFERENCES games(game_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    score_turn INTEGER NOT NULL,                          -- the save's turn; lower is better
    verdict TEXT NOT NULL,                                -- JSON Verdict
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The leaderboard: best run per challenge, ties by who got there first.
CREATE INDEX idx_challenge_submissions_board
    ON challenge_submissions(challenge_id, score_turn, created_at);
CREATE INDEX idx_challenge_submissions_user ON challenge_submissions(user_id);
