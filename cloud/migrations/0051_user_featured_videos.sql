-- Owner-curated "featured videos" — a user's own pick of their uploads, pinned
-- to the front of their profile's Videos tab.
--
-- The user-scoped twin of `featured_videos` (migration 0041, the site-admin
-- set), and a snapshot for the same reason: a channel's RSS feed returns ~15
-- entries, so the video a user wants at the top of their tab is exactly the one
-- that ages out of the feed first. The fields the platform owns — url, title,
-- thumbnail, publish date — are stored because they can't be re-derived once
-- the video leaves the feed.
--
-- Three differences from the admin table, all following from who writes here:
--   - There is no uploader attribution to store. `user_id` is both the curator
--     and the uploader (the write refuses a video that isn't in one of this
--     user's own linked channels), so the Videos tab's existing owner join
--     supplies the name and avatar live, the way CHANNELS_WITH_OWNER_SQL does.
--     Nothing about identity is frozen, so a rename follows.
--   - No `featured_by` column: the owner is the only writer, and `user_id`
--     already names them.
--   - ON DELETE CASCADE, matching `user_video_channels` (0031) rather than
--     0041's bare reference — these rows are the user's own content, so they go
--     with the account rather than outliving it as an orphan.
--
-- Composite PK (user_id, platform, video_id) — the per-user form of the
-- identity the video caches and the frontend list keys use, so re-featuring a
-- video updates its snapshot rather than duplicating it. Uncapped by design:
-- how many of their own videos a creator promotes is their call, and the tab's
-- own display cap (MAX_MERGED_VIDEOS) bounds what renders either way.
CREATE TABLE user_featured_videos (
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    video_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    thumbnail_url TEXT,
    published_at TEXT NOT NULL,
    featured_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, platform, video_id)
);
