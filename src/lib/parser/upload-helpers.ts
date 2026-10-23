// Shared helpers for the cloud upload flows (BulkUploadModal for new saves,
// BulkReparseModal for re-uploading an existing game's save). Extracted to
// avoid divergence between the two modals.

import type { FullGameData, PlayerRosterEntry } from "./types";
import type { WorkerMessage } from "./worker";

// Gzip an arbitrary value's JSON encoding to a Blob via CompressionStream.
// Used to build the `data` form field for POST /v1/games.
export async function gzipJson(obj: unknown): Promise<Blob> {
	const json = JSON.stringify(obj);
	const stream = new Blob([json])
		.stream()
		.pipeThrough(new CompressionStream("gzip"));
	return new Response(stream).blob();
}

/** A pre-selected seat and the signal that chose it. */
export type UploaderSuggestion = {
	playerIndex: number | null;
	// What the picker tells the user the pre-check means. `null` only when
	// nothing was suggested, and then `playerIndex` is null too.
	source: "known-id" | "save-owner" | null;
};

// Pick a sensible default uploader, and report which signal picked it so the
// picker can say what the pre-check means.
//
// The uploader's own identity goes first: exactly one human whose online_id is
// in their known set (captured from prior uploads) is the only signal that
// stays right when someone else saved the file. On an opponent's save of a
// game you both played, `is_save_owner` names them and that id names you.
//
// With no match, `is_save_owner` answers — the seat the file was written from,
// which is the uploader on an ordinary upload and the only signal there is on
// the very first one, before `user_online_ids` holds anything to match.
//
// Two or more matches claim nothing. Two ids attributed to one user appearing
// in one roster means at least one of those attributions is already wrong, and
// claiming writes the suspect id back: `captureOnlineIds` adds the claimed
// seat's id (cloud/src/games.ts:2279), no screen removes one again, and the id
// set is what sets the default on the next upload.
//
// A default, not an identity: the save owner is who SAVED the file, which
// differs from who is uploading it exactly on observer uploads (a TO
// archiving a match, a friend's save), so the picker still asks.
export function defaultSelection(
	humans: readonly Pick<
		PlayerRosterEntry,
		"player_index" | "online_id" | "is_save_owner"
	>[],
	knownOnlineIds: Set<string>,
): UploaderSuggestion {
	const matches = humans.filter(
		(h) => h.online_id && knownOnlineIds.has(h.online_id),
	);
	if (matches.length === 1) {
		return { playerIndex: matches[0].player_index, source: "known-id" };
	}
	if (matches.length > 1) return { playerIndex: null, source: null };
	const owner = humans.find((h) => h.is_save_owner);
	return owner
		? { playerIndex: owner.player_index, source: "save-owner" }
		: { playerIndex: null, source: null };
}

// A reparse re-uploads a save whose perspective was already chosen once, so
// the uploader is recovered rather than picked: find the unique human in the
// freshly parsed roster whose nation matches the stored one.
export type UploaderRecovery =
	{ ok: true; uploaderIndex: number | null } | { ok: false; message: string };

/**
 * Recover `uploader_player_index` for a reparse from the game's stored
 * uploader nation.
 *
 * `uploaderNation` must be the raw `games.user_nation` (the API serves it as
 * `uploader_nation`), NOT a COALESCE'd display value — null means the original
 * was an observer upload and stays one. An ambiguous or absent match is
 * returned as a failure rather than guessed, because the alternative is
 * silently re-claiming the wrong seat: `is_uploader`, `user_won` and the
 * profile's whole record of the game hang off this index.
 *
 * Shared by the browser sweep (BulkReparseModal) and the headless one
 * (`./per-ankh admin reparse-all`), which must agree — the two write through
 * the same endpoint and a divergence would show up as a reparse that quietly
 * changed whose game it is.
 */
export function recoverUploaderIndex(
	roster: readonly Pick<
		PlayerRosterEntry,
		"player_index" | "is_human" | "nation"
	>[],
	uploaderNation: string | null,
): UploaderRecovery {
	if (uploaderNation === null) return { ok: true, uploaderIndex: null };
	const candidates = roster.filter(
		(p) => p.is_human && p.nation === uploaderNation,
	);
	if (candidates.length === 1) {
		return { ok: true, uploaderIndex: candidates[0].player_index };
	}
	return {
		ok: false,
		message:
			candidates.length === 0
				? `No human player matches stored nation ${uploaderNation}`
				: `Multiple human players match stored nation ${uploaderNation}`,
	};
}

// Enriched human-player option for the upload picker. Superset of the roster
// entry — player_index / online_id still drive the upload + dedup logic — plus
// the display stats the picker card shows (city count, winner flag).
export interface PlayerChoice {
	player_index: number;
	player_name: string;
	nation: string | null;
	online_id: string | null;
	is_save_owner: boolean;
	city_count: number;
	is_winner: boolean;
}

// Build the human-player choices for a parsed save: roster fields plus the
// per-player city count and winner flag the picker renders. City counts come
// from city_statistics (owner_nation match, the same derivation the game-detail
// Overview uses); the winner is resolved from match_metadata.winner against the
// roster's player_index (both are XML player-id space — see PlayerRosterEntry).
export function playerChoices(data: FullGameData): PlayerChoice[] {
	const cityCountByNation = new Map<string, number>();
	for (const c of data.city_statistics.cities) {
		if (c.owner_nation == null) continue;
		cityCountByNation.set(
			c.owner_nation,
			(cityCountByNation.get(c.owner_nation) ?? 0) + 1,
		);
	}
	const winnerIndex = data.match_metadata.winner?.winner_player_xml_id ?? null;
	return data.player_roster
		.filter((p) => p.is_human)
		.map((p) => ({
			player_index: p.player_index,
			player_name: p.player_name,
			nation: p.nation,
			online_id: p.online_id,
			is_save_owner: p.is_save_owner,
			city_count: p.nation ? (cityCountByNation.get(p.nation) ?? 0) : 0,
			is_winner: winnerIndex !== null && p.player_index === winnerIndex,
		}));
}

export type ParseProgressCb = (phase: string, percent: number) => void;

export class ParseFailure extends Error {
	constructor(
		public code: string,
		message: string,
	) {
		super(message);
		this.name = "ParseFailure";
	}
}

// Promise-wrapped parse against a persistent Worker. The caller owns the
// Worker lifecycle (spawn once, reuse across many files, terminate on
// teardown). Only one parse runs at a time on a given Worker — callers
// serialize via await.
//
// `buffer` is transferred to the Worker; do not reuse it on the main side
// after this call. The Worker transfers it back inside the resolved
// `rawZip`, so ownership returns to the caller on success.
export function parseSaveFile(
	buffer: ArrayBuffer,
	fileName: string,
	worker: Worker,
	onProgress?: ParseProgressCb,
	{ requireCompleted = true }: { requireCompleted?: boolean } = {},
): Promise<{ data: FullGameData; rawZip: ArrayBuffer }> {
	return new Promise((resolve, reject) => {
		worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
			const msg = ev.data;
			if (msg.type === "progress") {
				onProgress?.(msg.phase, msg.percent);
			} else if (msg.type === "result") {
				resolve({ data: msg.data, rawZip: msg.rawZip });
			} else {
				reject(new ParseFailure(msg.code, msg.message));
			}
		};
		worker.postMessage(
			{ type: "parse", file: buffer, fileName, requireCompleted },
			{ transfer: [buffer] },
		);
	});
}
