-- Optional YouTube playlist for a tournament. When set, the tournament's
-- Videos tab surfaces the playlist's uploads (pulled from the free YouTube RSS
-- feed, KV-cached, stale-while-revalidate). NULL = no playlist configured, and
-- the Videos tab is hidden entirely. Not phase-locked (like `links`): admins add
-- and revise the playlist in every status, so there is no DB-level lock here.
ALTER TABLE tournaments ADD COLUMN youtube_playlist_url TEXT;
