import { cloudApi } from "$lib/api-cloud";
import { rethrowRateLimit } from "$lib/utils/load-errors";
import type { PageLoad } from "./$types";

// Tournament stats view. The tournament itself comes from the [slug] layout
// load; the two stats payloads are fetched here (Plane A competition + Plane B1
// save-content). Public and setup-gated: a pre-signup setup tournament already
// 404s from the layout's getTournament, so a reachable page always has visible
// stats. Both reads are independent → fetched in parallel.
export const load: PageLoad = async ({ params, parent, fetch }) => {
	// Fired before `await parent()`, not after it. Both reads take the slug
	// `params` already carries, so neither needs the layout's response to learn
	// an id — and awaiting the parent first was the whole of what put this page
	// a wave behind the layout's four reads (issue #292, Class B). These two
	// join that wave instead.
	//
	// The parent is still awaited before the pair is: `tournament.name` feeds
	// the meta below, and a dead or setup-hidden slug has to answer with the
	// layout's mapped 404 rather than with whichever raw ApiError these two
	// reject with first. The no-op `.catch` handles a *derived* promise, so the
	// await below still propagates the originals' failures into the catch block,
	// while a `parent()` throw can't leave either one rejecting unhandled —
	// same idiom as src/routes/upload/+page.ts.
	//
	// What joining the wave costs is on that 404 path, exactly as it is in the
	// layout: a dead or hidden slug now spends six `tournament_view` slots
	// instead of four, because these two are in flight before the layout's 404
	// lands. A reachable page spends six either way, and the ceiling is
	// 2400/hr per IP.
	const competitionPromise = cloudApi.getTournamentStats(params.slug, {
		fetch,
	});
	const gamesPromise = cloudApi.getTournamentGamesStats(params.slug, { fetch });
	competitionPromise.catch(() => {});
	gamesPromise.catch(() => {});

	const { tournament } = await parent();
	// Both reads draw on the per-IP tournament_view budget, and the layout's own
	// reads now draw on it in the same wave — so an exhausted budget fails them
	// together, which is still a 429 rather than a 500. Everything else
	// propagates unchanged.
	try {
		const [competition, games] = await Promise.all([
			competitionPromise,
			gamesPromise,
		]);
		return {
			competition,
			games,
			meta: {
				title: `${tournament.name} · Stats - Per-Ankh`,
				description: `Statistics for ${tournament.name} on Per-Ankh.`,
			},
		};
	} catch (err) {
		rethrowRateLimit(err);
		throw err;
	}
};
