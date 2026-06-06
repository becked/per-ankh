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

interface MatchNationLike {
	slot_a_nation: string | null;
	slot_b_nation: string | null;
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
