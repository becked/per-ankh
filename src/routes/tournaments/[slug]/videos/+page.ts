import { cloudApi } from "$lib/api-cloud";
import type { VideoArchive } from "$lib/tournament/video-archive";
import { rethrowRateLimit } from "$lib/utils/load-errors";
import type { PageLoad } from "./$types";

// Videos view — the tournament's recorded games, organised match -> part ->
// angle rather than as one flat upload grid. A match is one game, played across
// one or more parts, each of which may have been filmed from several angles: a
// caster's broadcast, or a player's own point of view.
//
// The Worker does the work. Grouping videos into parts needs each one's length
// and air time, and attributing a video to a match needs the tournament's
// roster, none of which belongs on the client. See
// cloud/src/tournament/video-archive.ts.
export const load: PageLoad = async ({ parent, fetch }) => {
	const { tournament } = await parent();
	// The tab linking here is hidden unless a playlist is set, so a direct visit
	// is the only way to reach an unconfigured tournament's Videos view. The
	// Worker would answer that honestly (`source: "none"`), but not for free —
	// the read spends a view-budget slot — so don't ask.
	const none: VideoArchive = { source: "none", matches: [], unattributed: [] };
	const archive = tournament.youtube_playlist_url
		? await cloudApi
				.getTournamentVideoArchive(tournament.tournament_id, { fetch })
				.catch((err: unknown) => {
					// A spent read budget is the one failure worth showing: an empty
					// list is indistinguishable from a tournament with no playlist, so
					// the visitor would be told there are no videos rather than to come
					// back.
					rethrowRateLimit(err);
					return none;
				})
		: none;

	return {
		archive,
		meta: {
			title: `${tournament.name} · Videos - Per-Ankh`,
			description: `Every recorded game of ${tournament.name}, by match, part and camera angle.`,
		},
	};
};
