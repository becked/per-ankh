-- Per-user casting stream link (twitch.tv / youtube.com, validated in the
-- Worker). Set from account preferences or remembered from the first cast
-- signup that provides one; when a user takes the streamer slot on a match
-- part, this URL is auto-attached to the part's streams so "I'll cast"
-- doesn't leave the sitting streamless. NULL = no auto-attach.
ALTER TABLE users ADD COLUMN stream_url TEXT;
