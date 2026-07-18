-- Per-user casting stream link (youtube.com / twitch.tv, validated in the
-- Worker). Set from account preferences or remembered from the first cast
-- signup that provides one; when a user takes the streamer slot on a match
-- part, this URL is auto-attached to the part's streams so "I'll cast"
-- doesn't leave the sitting streamless. NULL = no auto-attach.
ALTER TABLE users ADD COLUMN stream_url TEXT;

-- Backfill from casting history: for each user, the first stream URL on the
-- most recent part where they held the streamer slot (casters[0]). Streams
-- aren't attributed to users in the parts data, so this is a heuristic — in
-- practice the first stream on a cast sitting is the streamer's channel —
-- and it only seeds a default the user can change or clear in preferences.
UPDATE users SET stream_url = (
	SELECT json_extract(p.value, '$.streams[0].url')
	FROM tournament_matches m, json_each(m.parts) AS p
	WHERE m.parts IS NOT NULL AND json_valid(m.parts)
		AND json_extract(p.value, '$.casters[0].user_id') = users.user_id
		AND json_extract(p.value, '$.streams[0].url') IS NOT NULL
	ORDER BY m.rowid DESC LIMIT 1
) WHERE stream_url IS NULL;
