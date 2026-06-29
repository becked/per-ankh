-- Operator-set display alias overriding the Discord-sourced display_name.
--
-- Why: display_name (Discord global_name ?? username) and discord_username are
-- refreshed from Discord on every login, so they can't carry a stable hand-set
-- label. This nullable column holds an admin-only override. When non-NULL it
-- replaces display_name in every API response (resolved via COALESCE at read
-- time); NULL means "use display_name". The Discord columns are left untouched,
-- preserving identity/matching and operator ground-truth.

ALTER TABLE users ADD COLUMN alias TEXT;
