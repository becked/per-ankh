// The shape `GET /v1/tournaments/:id/video-archive` returns, and the one
// formatter the Videos tab needs on top of it.
//
// The logic that BUILDS this shape — clustering videos into parts by broadcast
// window, pricing a part, attributing a video to a match, deciding whether a
// recording is a cast or a point of view — lives in the Worker, at
// `cloud/src/tournament/video-archive.ts`, with its unit tests. It ran here
// briefly during development and must not again: two copies of a rule this
// fiddly drift within a day, and they did.

import type { TournamentVideo } from "$lib/api-cloud";

/** Who held the camera: a player filming their own game, or anyone else. */
export type Angle = "cast" | "pov";

export interface ArchiveAngle {
	video: TournamentVideo;
	channel: string;
	angle: Angle;
	/** Runtime; null for a broadcast still running, and on the keyless path. */
	seconds: number | null;
	aired: string;
}

export interface ArchivePart {
	/** 1-based position within the match, in the order the parts aired. */
	n: number;
	aired: string;
	/** Real time played: the union of every angle's broadcast window. */
	seconds: number;
	angles: ArchiveAngle[];
}

export interface ArchiveMatch {
	match_id: string;
	match_number: number | null;
	round_number: number;
	phase: string;
	division: string | null;
	status: string;
	slot_a_id: string;
	slot_b_id: string | null;
	slot_a_display_name: string | null;
	slot_b_display_name: string | null;
	slot_a_nation: string | null;
	slot_b_nation: string | null;
	winner_slot_id: string | null;
	map_script: string | null;
	total_turns: number | null;
	parts: ArchivePart[];
	/** Scheduled sittings with no surviving footage — the time above is a floor. */
	gaps: number;
}

export interface VideoArchive {
	/**
	 * Where the videos came from: the keyed Data API read, the keyless RSS
	 * fallback (recent entries only, no runtimes), or nothing because no
	 * playlist is configured. The three empty states are otherwise identical.
	 */
	source: "api" | "feed" | "none";
	matches: ArchiveMatch[];
	/** Videos no match claimed, so the gaps stay visible rather than dropped. */
	unattributed: TournamentVideo[];
}

/** "3h 06m", or "48m" under the hour. */
export function formatRuntime(seconds: number): string {
	const mins = Math.round(seconds / 60);
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
