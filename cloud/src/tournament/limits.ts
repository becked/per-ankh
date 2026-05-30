// Tournament rate-limit ceilings. Hardcoded for v1 — promote to
// wrangler.toml vars if operators need to retune during a live event.

// Per-user admin mutation budget. Spec said 30/hour/tournament; we
// simplified to per-user because the threat model (stolen admin
// session) is identical at our 4-admin-per-tournament scale.
export const TOURNAMENT_ADMIN_ACTIONS_PER_HOUR = 30;

// Per-user budget for match scheduling edits (scheduled time, stream link,
// caster). Separate from the admin budget because participants — not just
// admins — can schedule their own matches, and a participant has no admin
// budget to draw from. Generous: setting a time/stream/caster on a match is a
// handful of edits per match per player.
export const TOURNAMENT_SCHEDULE_ACTIONS_PER_HOUR = 60;

// Per-IP budget for anonymous tournament reads (list/detail/standings/
// bracket/rounds/matches/match-detail + game tournament-link). Scraper
// User-Agents bypass.
export const TOURNAMENT_VIEW_PER_HOUR = 600;

// Per-user budget for tournament creation. Tighter than admin mutations:
// creating a tournament adds rows + an admin row + squats a slug, and
// the legitimate use case (an organizer setting up a new event) is rare
// enough that 5/hour is generous. Spam at this rate is bounded by the
// cost of acquiring Discord accounts.
export const TOURNAMENT_CREATE_PER_USER_PER_HOUR = 5;

// Per-user budget for the TO-only CSV export. The work is cheap (bounded D1
// reads, no R2), so this is a runaway-client backstop rather than a real
// constraint — and every call writes a 'tournament_export' audit event, so
// the counter doubles as an export log. 30/hour is generous for an organizer
// pulling results.
export const TOURNAMENT_EXPORT_PER_HOUR = 30;
