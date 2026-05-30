// TO-only CSV export. GET /v1/tournaments/:id/export returns a zip of
// standings.csv + matches.csv for tournament organizers to keep, share, or
// analyze. Gated identically to the admin mutation handlers (beta + admin),
// with a generous per-user rate limit whose audit event doubles as an export
// log. The work is cheap — bounded D1 reads, no R2 — so this is a backstop,
// not a real constraint.

import { zipSync, strToU8 } from "fflate";

import { sessionFromRequest, type SessionEnv } from "../session";
import { cloudCorsHeaders, errorResponse } from "../util";
import { countEventsSince } from "../games";
import { logError } from "../log";
import { TOURNAMENT_EXPORT_PER_HOUR } from "./limits";
import {
	AuthzError,
	requireTournamentAdmin,
	requireTournamentBeta,
} from "./authz";
import {
	loadSlots,
	loadTournamentById,
	MapConfigError,
	parseMapPool,
	type MatchRow,
	type RoundRow,
	type TournamentEnv,
	type TournamentRow,
} from "./data";
import { computeStandingsResponse, loadMatchesWithRound } from "./public";

export interface TournamentExportEnv extends TournamentEnv, SessionEnv {
	ALLOWED_ORIGINS: string;
}

// --- CSV primitives (RFC 4180) -------------------------------------------

// Quote a field only when it contains a comma, quote, or newline; double any
// embedded quotes. null → empty cell.
export function csvField(value: string | number | null): string {
	if (value === null) return "";
	const s = String(value);
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(fields: (string | number | null)[]): string {
	return fields.map(csvField).join(",");
}

// UTF-8 BOM so Excel reads unicode Discord usernames correctly. Rows are
// CRLF-joined per the CSV convention.
function csvDocument(
	header: string[],
	rows: (string | number | null)[][],
): string {
	const lines = [csvRow(header), ...rows.map(csvRow)];
	return "﻿" + lines.join("\r\n") + "\r\n";
}

// --- Sheet builders ------------------------------------------------------

type StandingsResponse = Awaited<ReturnType<typeof computeStandingsResponse>>;

export function buildStandingsCsv(resp: StandingsResponse): string {
	const header = [
		"rank",
		"division",
		"player",
		"claimed",
		"wins",
		"losses",
		"status",
		"buchholz_cut1",
		"opponents_buchholz",
		"cumulative",
		"swiss_seed",
	];
	const rows: (string | number | null)[][] = [];
	for (const division of ["A", "B"] as const) {
		const { name, standings } = resp.divisions[division];
		for (const s of standings) {
			rows.push([
				s.rank,
				name,
				s.discord_username,
				s.user_id != null ? "yes" : "no",
				s.wins,
				s.losses,
				s.status,
				s.buchholz_cut1,
				s.opponents_buchholz,
				s.cumulative,
				s.swiss_seed,
			]);
		}
	}
	return csvDocument(header, rows);
}

export interface MatchWithRound {
	match: MatchRow;
	round: RoundRow;
}

// Resolve a slot's display name for a match row. Prefers the report-time
// snapshot (historically correct after substitutions); falls back to the
// slot's current occupant so pending/scheduled matches still show names.
function nameForSlot(
	slotId: string | null,
	snapshot: string | null,
	slotNames: Map<string, string | null>,
): string {
	if (slotId === null) return "";
	return snapshot ?? slotNames.get(slotId) ?? "";
}

export function buildMatchesCsv(
	rows: MatchWithRound[],
	slotNames: Map<string, string | null>,
	mapLabels: Map<string, string>,
): string {
	const header = [
		"phase",
		"division",
		"round",
		"match_index",
		"player_a",
		"player_b",
		"map",
		"status",
		"winner",
		"reported_at",
		"notes",
		"game_id",
	];
	const out: (string | number | null)[][] = [];
	for (const { match: m, round: r } of rows) {
		const nameA = nameForSlot(m.slot_a_id, m.slot_a_username, slotNames);
		const nameB = nameForSlot(m.slot_b_id, m.slot_b_username, slotNames);
		// Winner is whichever participant slot won; resolve via the same
		// snapshot-preferred names so it matches player_a/player_b.
		let winner = "";
		if (m.winner_slot_id === m.slot_a_id) winner = nameA;
		else if (m.winner_slot_id === m.slot_b_id) winner = nameB;
		else if (m.winner_slot_id !== null)
			winner = nameForSlot(m.winner_slot_id, null, slotNames);
		const map =
			m.map_script ??
			(m.map_pool_id ? (mapLabels.get(m.map_pool_id) ?? "") : "");
		out.push([
			r.phase,
			r.division,
			r.round_number,
			m.match_index,
			nameA,
			nameB,
			map,
			m.status,
			winner,
			m.reported_at,
			m.notes,
			m.game_id,
		]);
	}
	return csvDocument(header, out);
}

// --- Handler -------------------------------------------------------------

export async function handleTournamentExport(
	tournamentId: string,
	request: Request,
	env: TournamentExportEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) {
		// 401, not 404: this route is only ever reached from the admin UI.
		return errorResponse("Authentication required", 401, cors, "UNAUTHORIZED");
	}
	try {
		await requireTournamentBeta(env, session.data);
		await requireTournamentAdmin(env, session.data, tournamentId);
	} catch (e) {
		if (e instanceof AuthzError) {
			return errorResponse(e.message, e.status, cors, e.code);
		}
		throw e;
	}

	const exportCount = await countEventsSince(
		env.SHARE_DB,
		"tournament_export",
		"user_id",
		session.data.user_id,
	);
	if (exportCount >= TOURNAMENT_EXPORT_PER_HOUR) {
		return errorResponse(
			"Tournament export rate limit exceeded",
			429,
			cors,
			"RATE_LIMIT_TOURNAMENT_EXPORT",
		);
	}

	const tournament = await loadTournamentById(env, tournamentId);
	if (!tournament) {
		return errorResponse(
			"Tournament not found",
			404,
			cors,
			"TOURNAMENT_NOT_FOUND",
		);
	}

	const [standingsResp, matchesWithRound, slotRows] = await Promise.all([
		computeStandingsResponse(env, tournament, true),
		loadMatchesWithRound(env, tournament.tournament_id),
		loadSlots(env, tournament.tournament_id),
	]);

	const slotNames = new Map<string, string | null>();
	for (const s of slotRows) slotNames.set(s.slot_id, s.discord_username);

	// map_pool_id → played map script (label). Corrupt pools degrade to no
	// label rather than failing the whole export — matches still show
	// map_script when present.
	const mapLabels = new Map<string, string>();
	try {
		for (const e of parseMapPool(tournament)) mapLabels.set(e.id, e.script);
	} catch (e) {
		if (!(e instanceof MapConfigError)) throw e;
		logError("tournament_export_map_pool_parse_failed", e, {
			tournament_id: tournament.tournament_id,
		});
	}

	const standingsCsv = buildStandingsCsv(standingsResp);
	const matchesCsv = buildMatchesCsv(matchesWithRound, slotNames, mapLabels);

	const zip = zipSync({
		"standings.csv": strToU8(standingsCsv),
		"matches.csv": strToU8(matchesCsv),
	});

	// Fire-and-forget audit + rate-limit event (mirrors admin.ts).
	env.SHARE_DB.prepare(
		`INSERT INTO events (event_type, user_id, metadata)
		 VALUES ('tournament_export', ?, ?)`,
	)
		.bind(
			session.data.user_id,
			JSON.stringify({ tournament_id: tournament.tournament_id }),
		)
		.run()
		.catch((err: unknown) => {
			logError("tournament_export_audit_failed", err, {
				tournament_id: tournament.tournament_id,
				user_id: session.data.user_id,
			});
		});

	return new Response(zip, {
		status: 200,
		headers: {
			...cors,
			"Content-Type": "application/zip",
			"Content-Disposition": `attachment; filename="${tournament.slug}-export.zip"`,
		},
	});
}
