-- User-linked video/stream channels, surfaced as a "Videos" tab on the
-- public profile. Self-service: a user adds their own channel URL in
-- account settings, the Worker resolves it to a canonical per-platform
-- identifier (channel_id) and stores it here. Recent videos are then
-- fetched from the platform on demand and cached in KV — nothing about the
-- videos themselves is stored in D1.
--
-- Multi-platform by construction: `platform` selects which provider
-- (cloud/src/video/) knows how to resolve the URL and fetch videos.
-- YouTube ships first; Twitch et al. slot in by registering a provider,
-- no schema change.
--
-- Composite PK (user_id, platform): one channel per platform per user.
-- A user can link one YouTube + one Twitch + …; relax the PK to add a
-- surrogate id if multiple channels per platform is ever wanted.
--   - channel_url:  exactly what the user entered (canonicalized), for
--                   display and to seed the edit field.
--   - channel_id:   the resolved, provider-native identifier the fetch
--                   path needs (e.g. a YouTube UC… id for the RSS feed).
CREATE TABLE user_video_channels (
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    channel_url TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, platform)
);
