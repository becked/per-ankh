// Minimal shape accepted by the helpers below: anything that exposes a
// status, the two slot_ids, and the relevant snapshot column. Placeholder
// bracket matches use a slot_a_id of null (TBD feeder cell) — the helpers
// resolve that to a null label/avatar before any snapshot lookup.

interface MatchDisplayNameLike {
	status: "pending" | "complete" | "forfeit" | "bye";
	slot_a_id: string | null;
	slot_b_id: string | null;
	slot_a_display_name: string | null;
	slot_b_display_name: string | null;
}

interface MatchAvatarLike {
	status: "pending" | "complete" | "forfeit" | "bye";
	slot_a_id: string | null;
	slot_b_id: string | null;
	slot_a_avatar_url: string | null;
	slot_b_avatar_url: string | null;
}

interface MatchUserIdLike {
	status: "pending" | "complete" | "forfeit" | "bye";
	slot_a_id: string | null;
	slot_b_id: string | null;
	slot_a_user_id: string | null;
	slot_b_user_id: string | null;
}

// The slug helper needs the snapshot user_id as well as the snapshot slug —
// see matchSlotSlug for why the two can't be resolved independently.
interface MatchSlugLike extends MatchUserIdLike {
	slot_a_slug: string | null;
	slot_b_slug: string | null;
}

interface MatchNationLike {
	slot_a_nation: string | null;
	slot_b_nation: string | null;
}

interface MatchArchetypeLike {
	slot_a_archetype: string | null;
	slot_b_archetype: string | null;
}

interface MatchOutcomeLike {
	slot_a_id: string | null;
	slot_b_id: string | null;
	winner_slot_id: string | null;
}

// How one side of a match ended, from `winner_slot_id` — the tournament's own
// record of the result, defined for forfeits and byes where the linked save says
// nothing (see #113 on save `is_winner` vs `winner_slot_id`). Simpler than its
// snapshot-aware neighbours below: `winner_slot_id` compares against the stable
// `slot_a/b_id`, so a substitution never changes the answer and there's no
// snapshot-vs-live branch.
//   "pending" — no winner recorded yet.
//   null      — the side has no slot at all: a bye's empty side B, or an
//               unresolved feeder cell in a synthesized bracket placeholder.
export function matchSlotOutcome(
	match: MatchOutcomeLike,
	side: "a" | "b",
): "won" | "lost" | "pending" | null {
	const slotId = side === "a" ? match.slot_a_id : match.slot_b_id;
	if (slotId === null || slotId === "") return null;
	if (match.winner_slot_id === null) return "pending";
	return match.winner_slot_id === slotId ? "won" : "lost";
}

// Nation each side played, resolved server-side via the slot↔player_index
// mapping against the linked game. Null when unknown (no save, bye, forfeit,
// admin-set, or legacy match) — callers render the crest only when non-null.
// No live fallback: nation is a property of the game that was played, not of
// the slot's current occupant, so it never changes under a substitution.
export function matchSlotNation(
	match: MatchNationLike,
	side: "a" | "b",
): string | null {
	return side === "a" ? match.slot_a_nation : match.slot_b_nation;
}

// Starting-ruler archetype each side was dealt, from the same
// player_summaries row the nation resolves from and null in the same cases.
// Like the nation, it's a property of the game that was played — no live
// fallback, so a substitution never changes it.
export function matchSlotArchetype(
	match: MatchArchetypeLike,
	side: "a" | "b",
): string | null {
	return side === "a" ? match.slot_a_archetype : match.slot_b_archetype;
}

// Returns the display name for one side of a match. For non-pending matches
// we prefer the snapshot-derived label (server-resolved from the occupant
// pinned at report time) so a later substitution doesn't rewrite who played.
// Pending matches fall through to live data — a substitute paired into an
// upcoming round should appear under the new name immediately. The live map
// is keyed by slot_id.
export function matchSlotDisplayName(
	match: MatchDisplayNameLike,
	side: "a" | "b",
	liveBySlotId: Record<string, string | null | undefined>,
): string | null {
	const slotId = side === "a" ? match.slot_a_id : match.slot_b_id;
	if (slotId === null) return null;
	if (match.status !== "pending") {
		const snap =
			side === "a" ? match.slot_a_display_name : match.slot_b_display_name;
		if (snap !== null && snap !== undefined) return snap;
	}
	return liveBySlotId[slotId] ?? null;
}

// Avatar URL for one side of a match, with the same snapshot-vs-live rule.
export function matchSlotAvatarUrl(
	match: MatchAvatarLike,
	side: "a" | "b",
	liveBySlotId: Record<string, string | null | undefined>,
): string | null {
	const slotId = side === "a" ? match.slot_a_id : match.slot_b_id;
	if (slotId === null) return null;
	if (match.status !== "pending") {
		const snap =
			side === "a" ? match.slot_a_avatar_url : match.slot_b_avatar_url;
		if (snap !== null && snap !== undefined) return snap;
	}
	return liveBySlotId[slotId] ?? null;
}

// The per-ankh account behind one side of a match, with the same snapshot-vs-
// live rule as the name and avatar above — which is the whole point of it
// living here rather than being read off `slot_a/b_user_id` at each link site.
// A decided match shows the occupant pinned at report time, so its link must go
// to that player; resolving the id from the live slot instead would point a
// substituted-out player's name at whoever holds their seat now. Null when the
// side has no slot, or when the occupant has no per-ankh account (an unclaimed
// slot) — callers render exactly as before in that case rather than linking.
export function matchSlotUserId(
	match: MatchUserIdLike,
	side: "a" | "b",
	liveBySlotId: Record<string, string | null | undefined>,
): string | null {
	const slotId = side === "a" ? match.slot_a_id : match.slot_b_id;
	if (slotId === null) return null;
	if (match.status !== "pending") {
		const snap = side === "a" ? match.slot_a_user_id : match.slot_b_user_id;
		if (snap !== null && snap !== undefined) return snap;
	}
	return liveBySlotId[slotId] ?? null;
}

// The profile slug of that same occupant — the other half of the URL
// matchSlotUserId names, which is why it lives here rather than being read off
// `slot_a/b_slug` at each link site.
//
// Both halves must come from the SAME source, so this branches on the snapshot
// *user_id* rather than on the snapshot slug: a decided match whose pinned
// occupant simply has no slug carries a non-null snapshot id and a null
// snapshot slug, and falling through to the live map on that null would pair
// the historical player's id with the current occupant's slug — and profileHref
// prefers the slug, so the link would quietly open the wrong player's profile
// after a substitution. Committing to the snapshot's null instead just yields
// the id URL, which redirects correctly.
//
// Null likewise when the side has no slot and when the resolved occupant has no
// account at all — every case degrading to the permanent id permalink.
export function matchSlotSlug(
	match: MatchSlugLike,
	side: "a" | "b",
	liveBySlotId: Record<string, string | null | undefined>,
): string | null {
	const slotId = side === "a" ? match.slot_a_id : match.slot_b_id;
	if (slotId === null) return null;
	if (match.status !== "pending") {
		const snapUserId =
			side === "a" ? match.slot_a_user_id : match.slot_b_user_id;
		if (snapUserId !== null && snapUserId !== undefined) {
			return (side === "a" ? match.slot_a_slug : match.slot_b_slug) ?? null;
		}
	}
	return liveBySlotId[slotId] ?? null;
}

// Builds the "A v B" matchup string — the single home for that shape, shared by
// the matches table/calendar, the Cast view, and the sesh export. `sideLabel`
// resolves each side's text (a display name with the caller's own fallback, or a
// Discord mention in the sesh export); side B collapses to `byeText` when the
// match has no second slot, so the bye rule lives here rather than being
// reimplemented (or forgotten) at each call site.
export function matchupLabel(
	match: Pick<MatchDisplayNameLike, "slot_b_id">,
	sideLabel: (side: "a" | "b") => string,
	byeText = "Bye",
): string {
	const a = sideLabel("a");
	const b = match.slot_b_id === null ? byeText : sideLabel("b");
	return `${a} v ${b}`;
}
