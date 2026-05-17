// Module-scoped store for the active tournament-enrollment banner. The
// root layout populates it from /v1/users/me/tournaments after auth
// resolves; TournamentBanner.svelte reads it. Dismissing a banner POSTs
// to the worker (which sets claim_banner_dismissed_at on the slot row)
// and updates the store optimistically.

import { writable } from "svelte/store";
import type { MyTournamentEntry } from "$lib/api-cloud";

export const tournamentNotices = writable<MyTournamentEntry[]>([]);

// Remove a tournament from the in-memory store. Called after a successful
// dismiss POST so the banner disappears without a full page reload.
export function markTournamentDismissed(tournamentId: string): void {
	tournamentNotices.update((list) =>
		list.filter((t) => t.tournament_id !== tournamentId),
	);
}
