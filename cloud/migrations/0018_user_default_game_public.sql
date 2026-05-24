-- Per-user default visibility for newly uploaded saves.
--
-- Why: uploads used to land private (is_public=0) unless the user flipped
-- them — see buildGameRow in cloud/src/games.ts, where a fresh upload with
-- no isPublicOverride defaulted to 0. We're flipping the product default to
-- public, but letting users opt back into private-by-default. This column
-- holds that per-user preference; the fresh-upload branch reads it.
--
-- DEFAULT TRUE flips the default to public for everyone (new and existing
-- users) on their *future* uploads. Existing games keep whatever is_public
-- they already have — this only feeds the default for new uploads, and
-- re-imports still preserve the existing row's value. Tournament uploads are
-- forced public regardless and ignore this setting.

ALTER TABLE users ADD COLUMN default_game_public BOOLEAN NOT NULL DEFAULT TRUE;
