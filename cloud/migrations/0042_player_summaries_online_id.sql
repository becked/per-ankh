-- The seat's multiplayer online id (Steam/GOG/Epic), from the roster —
-- lets the played-games leaderboard credit non-uploader participants by
-- matching against user_online_ids. Linking data only: never exposed via
-- any API response, same lane as user_online_ids. NULL for AI seats and
-- single-player games; backfilled by the admin reindex sweep.
ALTER TABLE player_summaries ADD COLUMN online_id TEXT;
