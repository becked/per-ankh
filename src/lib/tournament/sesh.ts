import type { TournamentMatch } from "$lib/api-cloud";
import { matchSlotDisplayName, matchupLabel } from "./match-occupant";
import { padMatchNumber } from "./match-numbers";

// A single "sesh.fyi"-style match line for a Discord post:
//   "Match NNN (Part Y) - <versus> - <t:UNIX:F> (<t:UNIX:R>)"
// `<t:UNIX:F>` renders the full local date, `<t:UNIX:R>` the relative
// "in X hours/days". The "(Part Y)" tag shows only for split matches; the
// timestamp is omitted when the sitting has no time yet (a "to be scheduled"
// line). `versus` is the caller's already-built "A v B" (matchupLabel) — a
// mention in the admin posts, a plain name otherwise. Shared by the
// matches-page sesh export and the match popover's caster post so the line
// format lives in exactly one place.
export function seshMatchLine(opts: {
	matchNumber: number | null;
	versus: string;
	partNumber: number;
	split: boolean;
	scheduledAt?: string | null;
}): string {
	const num = opts.matchNumber != null ? padMatchNumber(opts.matchNumber) : "?";
	const partTag = opts.split ? `(Part ${opts.partNumber}) ` : "";
	let line = `Match ${num} ${partTag}- ${opts.versus}`;
	if (opts.scheduledAt) {
		const unix = Math.floor(Date.parse(opts.scheduledAt) / 1000);
		line += ` - <t:${unix}:F> (<t:${unix}:R>)`;
	}
	return line;
}

// The "A v B" matchup for a sesh post: each side prefers a real Discord `<@id>`
// mention (pings the player) when we have the id — an admin-only field, so posts
// carry mentions for admins and plain display names for everyone else — and
// falls back to the slot's display name (then "?") when there's no id. The bye
// rule lives in `matchupLabel`. Shared by the matches-page sesh export and the
// popover's caster post so this mention/fallback logic isn't a second copy.
export function seshVersus(
	match: TournamentMatch,
	slotLabels: Record<string, string>,
): string {
	return matchupLabel(match, (side) => {
		const id = side === "a" ? match.slot_a_discord_id : match.slot_b_discord_id;
		return id
			? `<@${id}>`
			: (matchSlotDisplayName(match, side, slotLabels) ?? "?");
	});
}
