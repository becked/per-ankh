-- Add Discord's @ handle (lowercased) to the users table.
--
-- Why: tournament_slots.discord_username has long stored the lowercased
-- Discord handle (mirrors handleDiscordCallback's `discordUser.username
-- .toLowerCase()` at cloud/src/auth.ts:400), but the users table only kept
-- display_name (= `global_name ?? username`). Two paths need the raw handle
-- on users:
--   1. The new /v1/users/search autocomplete for the slot-creation form,
--      which has to prefix-match the canonical handle (not display_name,
--      which may diverge).
--   2. Future pre-linking of slots: handleBulkCreateSlots can accept a
--      user_id and resolve the canonical discord_username from users so
--      the client can't spoof a mismatched handle into the slot row.
--
-- Backfill: none. handleDiscordCallback's upsert (next migration to wire)
-- writes the column on every login. Existing users stay NULL until they
-- next sign in; the autocomplete query naturally skips NULL rows.
-- Active users self-heal within a login cycle; inactive users were
-- invisible to autocomplete anyway.

ALTER TABLE users ADD COLUMN discord_username TEXT;

-- Prefix-search index. Matches the /v1/users/search query pattern of
-- `WHERE discord_username LIKE ?` with `q + '%'` (prefix-only). SQLite uses
-- this index for the LIKE optimization when case-sensitive matching is
-- ensured by storing the column lowercase (which we do at write time).
CREATE INDEX idx_users_discord_username ON users(discord_username);
