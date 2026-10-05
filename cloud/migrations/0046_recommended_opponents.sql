-- Recommended opponents: the twelve players each user is shown on the
-- Suggested tab of their own profile.
--
-- Rebuilt nightly, right after user_ratings (0045), by
-- cloud/src/ratings/recommend.ts. Nightly rather than per request for three
-- reasons: the balancing term needs a global view (how many *other* lists a
-- candidate already appears on, so the same settled mid-ladder player isn't
-- recommended to everybody), a daily refresh makes probing the model slow, and
-- the read path then costs one indexed SELECT.
--
-- What is NOT in this table is the point of it. No win probability, no rating
-- gap, no score, no deviation — not in a column, not in the JSON the page
-- fetches, not in a data attribute. Per-Ankh shows nobody a rating, and the
-- weakest link in that promise is a number that leaks out of the recommender,
-- so the numbers stop at the Worker and only names and observable facts are
-- persisted. `position` orders the list by when the opponent was last active,
-- not by anything rating-derived, so even the ordering carries nothing (see
-- recommend.ts).
--
-- `badges` is a JSON array of keys the frontend maps to copy — every one of
-- them a fact the viewer could establish themselves by reading profiles
-- ("new here", "active this week"), which is why both are counted over public
-- games only and neither reads a login (ratings/recommend.ts). `meetings` is the number of rated games
-- the pair has already played, which the "played N times" badge renders.
-- `computed_at` is the run that wrote the row; a rebuild replaces rows in
-- place and sweeps the ones it did not touch (ratings/rebuild.ts).
CREATE TABLE user_recommended_opponents (
    user_id          TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    position         INTEGER NOT NULL,
    opponent_user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    meetings         INTEGER NOT NULL DEFAULT 0,
    badges           TEXT NOT NULL,   -- JSON array of badge keys
    computed_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, position)
);

-- Whether other players may be shown this user as a suggested opponent.
--
-- Defaults on, and the precedent for flipping a product default on with an
-- opt-out rather than shipping an empty opt-in is 0018 (default_game_public).
-- The pool here is narrower still: only players who have already fought a
-- rated multiplayer game are in it at all, and what a viewer learns is a name
-- and a link to a profile that was already public. Turning it off removes the
-- user from everyone's list; it does not stop them receiving their own.
ALTER TABLE users ADD COLUMN open_to_matches BOOLEAN NOT NULL DEFAULT TRUE;
