import { error } from "@sveltejs/kit";
import { ApiError, cloudApi } from "$lib/api-cloud";
import { rethrowRateLimit } from "$lib/utils/load-errors";
import type { LayoutLoad } from "./$types";

// Shared tournament data for every page under /tournaments/[slug] (the overview
// and the schedule view both need the tournament, standings, bracket, and match
// list). Loaded once here so child pages don't refetch; each page contributes
// only its own page meta. SvelteKit merges this layout data into page data.
export const load: LayoutLoad = async ({ params, fetch }) => {
	// Public — shared tournament URLs render for anonymous visitors.
	//
	// One wave, not two. The three sub-resource reads take the slug as readily
	// as the id, so none of them waits for the detail response to learn one —
	// which is all the sequence here used to be for, and the whole of this
	// route's contribution to the waterfall a distant visitor pays (issue #292).
	// Bracket is empty until championship phase; that's fine, the component
	// renders a placeholder.
	//
	// All four reads draw on the same per-IP tournament_view budget, so an
	// exhausted budget fails them together, and a 404 from any of them lands on
	// the not-found page — which is the honest answer both for a missing
	// tournament and for one that vanished mid-flight.
	//
	// What starting them together costs is on that 404 path: a dead slug now
	// spends four `tournament_view` slots instead of one, because all four reads
	// are in flight before the first 404 arrives. Accepted — a *reachable* page
	// always spent four, the ceiling is 2400/hr per IP, and the alternative is
	// to charge every real visitor a serial wave to save a crawler three slots.
	try {
		const [tournament, standings, bracket, matches] = await Promise.all([
			cloudApi.getTournament(params.slug, { fetch }),
			cloudApi.getTournamentStandings(params.slug, { fetch }),
			cloudApi.getTournamentBracket(params.slug, { fetch }),
			cloudApi.getTournamentMatches(params.slug, {}, { fetch }),
		]);

		return {
			tournament,
			standings,
			bracket,
			matches: matches.matches,
		};
	} catch (err) {
		rethrowRateLimit(err);
		if (err instanceof ApiError && err.status === 404) {
			throw error(404, "Tournament not found");
		}
		throw err;
	}
};
