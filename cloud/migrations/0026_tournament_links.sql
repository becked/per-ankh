-- Admin-editable external links for a tournament.
--
-- Why: organizers want to surface a few external links on the tournament page
-- (e.g. a "Map pics" reference site, a Discord invite, a bracket/VOD link).
-- Rather than hardcode one tournament's links, every tournament carries an
-- ordered list of { label, url } pairs, edited by its admins and shown in the
-- "Links" menu alongside the Guide button.
--
-- JSON-encoded array, mirroring the map_pool column (migration 0019). NOT NULL
-- with a '[]' default so every row — including pre-existing ones — reads as an
-- empty list without a backfill. Unlike map_pool/Swiss config, links are not
-- frozen once the tournament starts (admins add VODs/results links mid-run and
-- after completion). Validated on write by PatchTournamentSchema.links (each url
-- restricted to http(s)); read leniently by parseLinks. Forward-only.

ALTER TABLE tournaments ADD COLUMN links TEXT NOT NULL DEFAULT '[]';
