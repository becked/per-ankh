-- User-uploaded game screenshots (issue #289): one WebP per screenshot in R2,
-- served public from img.per-ankh.app, indexed here.
--
-- A screenshot requires its game to be PUBLIC, and that invariant is what lets
-- the objects be served from a cacheable public host with no per-request gate.
-- It is enforced on both sides: the upload endpoint refuses on a private game,
-- and PATCH /v1/games/:id refuses to unpublish a game that still has
-- screenshots (cloud/src/games.ts, alongside LINKED_TO_ACTIVE_TOURNAMENT and
-- the open-challenge run). So nothing here needs an is_public join — the
-- readers filter on the hidden columns alone, and nothing downstream should
-- add one.

-- ============================================================
-- GAME_SCREENSHOTS
-- One row per stored object. `user_id` is the uploader, who is always the
-- game's owner (the upload gate requires it) — carried here rather than
-- joined so the per-account cap and the profile tab are single-table reads.
--
-- The Clef probabilities are the classifier's verdict as it stood when the
-- bytes were stored, never recomputed: they are what makes the admin queue
-- sortable and what says which question tripped. Column names are the
-- question ids the eval measured the bands against
-- (scripts/eval-screenshot-classifier.ts), so a row names its own question.
--
-- hidden_at and hidden_by together are the hidden state, and it is two states
-- rather than one. They differ in whether the object still exists, which is
-- what every reader of this table turns out to need: a queued row goes to its
-- own uploader, a taken-down one goes to nobody, and only a queued one holds a
-- quota slot or pins its game public.
--
--   hidden_at IS NOT NULL AND hidden_by IS NULL  the classifier queued it.
--                                                The object is in R2, so the
--                                                queue can approve it.
--   hidden_by IS NOT NULL                        an admin took it down. The
--                                                object is gone and purged, so
--                                                there is nothing to restore
--                                                and the row is a closed
--                                                decision.
--
-- A review-band upload is stored hidden with its object in R2, awaiting an
-- admin decision; a takedown deletes the object and purges it from the edge (a
-- public cached URL has no per-request gate to re-evaluate, so clearing
-- hidden_at alone would not stop the edge serving it). Without hidden_by the
-- two are one state, and the queue would offer to approve a row whose bytes no
-- longer exist — which restores a tile that renders broken — and would keep
-- asking for a decision an admin already made.
--
-- hidden_by is the featured_by shape below, which is the shape resolved_by on
-- screenshot_reports uses too: a moderation decision records who made it.
-- ============================================================
CREATE TABLE game_screenshots (
    screenshot_id TEXT PRIMARY KEY,                       -- nanoid(21)
    game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    r2_key TEXT NOT NULL,                                 -- screenshots/{game_id}/{screenshot_id}.webp
    width INTEGER NOT NULL,                               -- of the stored variant, read from its own header
    height INTEGER NOT NULL,
    size_bytes INTEGER NOT NULL,
    caption TEXT,

    -- Four nouls and the score, one Clef forward pass. Bands are conjunctive:
    -- a high is_old_world never relaxes the safety questions.
    is_old_world REAL NOT NULL,
    contains_nsfw REAL NOT NULL,
    contains_gore REAL NOT NULL,
    is_a_photograph REAL NOT NULL,
    -- A probability-weighted LEVEL (0-4 against the eval's rubric), not a
    -- probability, so it is stored to sort the queue and never thresholded.
    game_screenshot_confidence REAL NOT NULL,
    game_screenshot_probabilities TEXT NOT NULL,          -- JSON, per-level

    featured_at TEXT,                                     -- the home strip's star
    featured_by TEXT REFERENCES users(user_id),
    hidden_at TEXT,
    hidden_by TEXT REFERENCES users(user_id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The game-detail strip, and the per-game cap's COUNT(*).
CREATE INDEX idx_game_screenshots_game ON game_screenshots(game_id, created_at);
-- The profile Screenshots tab, and the per-account cap's COUNT(*).
CREATE INDEX idx_game_screenshots_user ON game_screenshots(user_id, created_at);
-- The curated home strip. Partial, because the starred rows are a handful of
-- the whole table. No index for the admin queue's complement: the 5-per-game
-- cap bounds this table at ~5k rows, which an admin page can scan.
CREATE INDEX idx_game_screenshots_featured
    ON game_screenshots(featured_at) WHERE featured_at IS NOT NULL;

-- ============================================================
-- SCREENSHOT_REPORTS
-- Moderation layer 2: a viewer reports a screenshot, an admin resolves it.
-- A table rather than only `events` because the queue needs state and
-- `events` is append-only under the nightly retention sweep.
--
-- Composite PK, the shape featured_videos (0041) uses and for the same
-- reason: one open report per reporter per screenshot, so re-reporting
-- updates the row rather than inflating the queue with duplicates.
-- ============================================================
CREATE TABLE screenshot_reports (
    screenshot_id TEXT NOT NULL REFERENCES game_screenshots(screenshot_id) ON DELETE CASCADE,
    reporter_user_id TEXT NOT NULL REFERENCES users(user_id),
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    resolved_by TEXT REFERENCES users(user_id),
    PRIMARY KEY (screenshot_id, reporter_user_id)
);

-- The queue: open reports, oldest first.
CREATE INDEX idx_screenshot_reports_open
    ON screenshot_reports(created_at) WHERE resolved_at IS NULL;

-- ============================================================
-- USERS.SCREENSHOT_TERMS_ACCEPTED_AT
-- When the user accepted the screenshot upload terms. NULL means they have
-- not, and the upload endpoint refuses with TERMS_NOT_ACCEPTED — the error
-- code the UI turns into the terms prompt.
--
-- The slug_changed_at shape from 0040: a column rather than an `events` read,
-- because the gate has to be decidable from the same row the upload path
-- already holds, and `events` lives on a different binding (EVENTS_DB, never
-- a SHARE_DB replica session) with a window fixed at one hour.
--
-- No index: the one reader holds the row by user_id (the PK).
-- ============================================================
ALTER TABLE users ADD COLUMN screenshot_terms_accepted_at TEXT;
