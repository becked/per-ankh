import { cloudApi } from "$lib/api-cloud";
import type { PageLoad } from "./$types";

// Videos view — the uploads from the tournament's admin-set YouTube playlist.
// The playlist itself lives on the tournament (loaded once by the [slug] layout);
// this page fetches its videos, but only when a playlist is configured, and sets
// its own meta. The tab linking here is hidden unless youtube_playlist_url is
// set, so a direct visit is the only way to reach an unconfigured tournament's
// Videos view — it renders the empty state rather than 404ing. Best-effort like
// the home creator feed: an upstream hiccup yields an empty grid, not an error.
export const load: PageLoad = async ({ parent, fetch }) => {
	const { tournament } = await parent();
	const videos = tournament.youtube_playlist_url
		? await cloudApi
				.getTournamentPlaylistVideos(tournament.tournament_id, { fetch })
				.catch(() => [])
		: [];
	return {
		videos,
		meta: {
			title: `${tournament.name} · Videos - Per-Ankh`,
			description: `Videos for ${tournament.name} on Per-Ankh.`,
		},
	};
};
