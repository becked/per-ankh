// Reconstruct the decisive 1v1 duels between registered users that the rating
// model runs on, entirely from D1. Two sources:
//
//   1. Tournament matches — both players' user_ids and the winner are
//      snapshotted on tournament_matches, so these are exact.
//   2. Casual games — a two-human, single-winner game whose roster slots both
//      resolve to a registered user, by looking each slot's online_id up in
//      user_online_ids (player_summaries.online_id, migration 0043).
//
// Resolution is by online_id and user_id only. Nothing here matches on a
// player's name: an Old World save's display name is whatever the player typed
// that day, and two people who both call themselves "ninja" are not the same
// account. A slot whose online_id maps to no user, or to more than one, is
// simply unresolved and its game is skipped — a rating built on a guessed
// identity is worse than one built on fewer games.
//
// Duels are de-duplicated across both sources by the game's stable
// xml_game_id, so a match that both players uploaded, or that was uploaded
// casually *and* archived into a tournament, counts once. All bulk D1 — no R2,
// no per-game round trips.

import { canonicalMapScript } from "../tournament/canonical-maps";
import type { Duel } from "./glicko2";

export interface ResolvedDuel extends Duel {
	// Dedup key: the game's xml_game_id when there is one, else a synthetic id
	// for a tournament match reported with no save attached.
	key: string;
	source: "tournament" | "casual";
	// The map script they played it on, canonicalised so the two spellings the
	// two sources use compare equal (canonicalMapScript). Null when the record
	// doesn't say — an old game row, or a tournament match with no map set.
	// Read by the map suggestion, not by the rating engine.
	script: string | null;
}

export interface DuelExtraction {
	duels: ResolvedDuel[];
	// Diagnostics, logged by the nightly rebuild and echoed by the admin
	// trigger — the only visibility an operator has into how much of the game
	// corpus the model actually sees.
	stats: {
		tournament: number;
		casual: number;
		deduped: number;
		casualGamesScanned: number;
		// Two-human decisive games dropped because a slot resolved to no user…
		unresolvedOpponent: number;
		// …or because its online_id is claimed by more than one account.
		ambiguousOnlineId: number;
	};
}

// online_id -> the single user who owns it. Ids claimed by two accounts resolve
// to null: whichever we picked would be a coin flip, and the "this is me"
// claim path is where that gets sorted out, not here.
async function loadOnlineIdIndex(
	db: D1Database,
): Promise<Map<string, string | null>> {
	const rows = await db
		.prepare("SELECT online_id, user_id FROM user_online_ids")
		.all<{ online_id: string; user_id: string }>();
	const index = new Map<string, string | null>();
	for (const r of rows.results ?? []) {
		if (index.has(r.online_id)) {
			if (index.get(r.online_id) !== r.user_id) index.set(r.online_id, null);
		} else {
			index.set(r.online_id, r.user_id);
		}
	}
	return index;
}

// Tournament matches: both user_ids and the winner are already columns. Joined
// to games so a match with an attached save carries that save's xml_game_id and
// can dedup against the casual copy of the same game.
async function tournamentDuels(db: D1Database): Promise<ResolvedDuel[]> {
	const rows = await db
		.prepare(
			`SELECT m.match_id, m.slot_a_id, m.slot_a_user_id, m.slot_b_user_id,
			        m.winner_slot_id, m.map_script,
			        substr(COALESCE(m.reported_at, m.created_at), 1, 10) AS dt,
			        g.xml_game_id
			   FROM tournament_matches m
			   LEFT JOIN games g ON g.game_id = m.game_id
			  WHERE m.status IN ('complete', 'forfeit')
			    AND m.slot_a_user_id IS NOT NULL
			    AND m.slot_b_user_id IS NOT NULL
			    AND m.winner_slot_id IS NOT NULL`,
		)
		.all<{
			match_id: string;
			slot_a_id: string;
			slot_a_user_id: string;
			slot_b_user_id: string;
			winner_slot_id: string;
			map_script: string | null;
			dt: string | null;
			xml_game_id: string | null;
		}>();

	const out: ResolvedDuel[] = [];
	for (const r of rows.results ?? []) {
		// A slot pair pointing at one account is a data error, not a duel.
		if (r.slot_a_user_id === r.slot_b_user_id) continue;
		out.push({
			key: r.xml_game_id ?? `match:${r.match_id}`,
			date: r.dt ?? "",
			p1: r.slot_a_user_id,
			p2: r.slot_b_user_id,
			winner:
				r.winner_slot_id === r.slot_a_id ? r.slot_a_user_id : r.slot_b_user_id,
			source: "tournament",
			script: r.map_script ? canonicalMapScript(r.map_script) : null,
		});
	}
	return out;
}

interface HumanSlotRow {
	game_id: string;
	xml_game_id: string;
	uploader_user_id: string | null;
	map_class: string | null;
	dt: string | null;
	is_uploader: number;
	is_winner: number;
	online_id: string | null;
}

// Casual games. One scan of every human roster slot in the database, grouped by
// game in memory — the "exactly two humans, exactly one winner" test is applied
// once, here, rather than restated as a correlated subquery in each of two
// SELECTs where the two copies could drift apart.
async function casualDuels(
	db: D1Database,
	onlineIds: Map<string, string | null>,
	stats: DuelExtraction["stats"],
): Promise<ResolvedDuel[]> {
	const rows = await db
		.prepare(
			`SELECT ps.game_id, ps.is_uploader, ps.is_winner, ps.online_id,
			        g.xml_game_id, g.user_id AS uploader_user_id, g.map_class,
			        substr(COALESCE(g.save_date, g.created_at), 1, 10) AS dt
			   FROM player_summaries ps
			   JOIN games g ON g.game_id = ps.game_id
			  WHERE ps.is_human = 1`,
		)
		.all<HumanSlotRow>();

	const byGame = new Map<string, HumanSlotRow[]>();
	for (const r of rows.results ?? []) {
		const slots = byGame.get(r.game_id);
		if (slots) slots.push(r);
		else byGame.set(r.game_id, [r]);
	}

	const out: ResolvedDuel[] = [];
	for (const slots of byGame.values()) {
		if (slots.length !== 2) continue;
		if (slots.filter((s) => s.is_winner === 1).length !== 1) continue;
		stats.casualGamesScanned += 1;

		const resolved: { userId: string; isWinner: boolean }[] = [];
		let ambiguous = false;
		for (const s of slots) {
			// online_id first, for every slot including the uploader's. An
			// observer upload (a tournament admin archiving someone else's save)
			// has no is_uploader slot at all, and even when it does, the id in the
			// save is the better answer than "whoever's account this arrived
			// through". games.user_id is the fallback for the uploader's own slot
			// on a hotseat save, where the roster carries no OnlineID.
			const byOnlineId = s.online_id ? onlineIds.get(s.online_id) : undefined;
			if (byOnlineId === null) ambiguous = true;
			const userId =
				byOnlineId ?? (s.is_uploader === 1 ? s.uploader_user_id : null);
			if (userId) resolved.push({ userId, isWinner: s.is_winner === 1 });
		}

		if (resolved.length !== 2 || resolved[0].userId === resolved[1].userId) {
			if (ambiguous) stats.ambiguousOnlineId += 1;
			else stats.unresolvedOpponent += 1;
			continue;
		}
		const winner = resolved.find((r) => r.isWinner);
		if (!winner) continue;
		out.push({
			key: slots[0].xml_game_id,
			date: slots[0].dt ?? "",
			p1: resolved[0].userId,
			p2: resolved[1].userId,
			winner: winner.userId,
			source: "casual",
			script: slots[0].map_class
				? canonicalMapScript(slots[0].map_class)
				: null,
		});
	}
	return out;
}

// Merge the two sources into one duel per key.
//
// A tournament record wins a shared key — it is the reported, official result —
// but winning the key is not the same as winning every field. The two sources
// learn the map from different places: a tournament duel reads the match row's
// map_script, a casual one reads the save's map_class. A match reported without
// a map set, against a save that has one, would otherwise drop a game out of
// the map history for no better reason than which row happened to hold the key.
// So the result comes from the tournament record and the script from whichever
// source knows it.
//
// A duel with no date is dropped rather than silently landing in whichever
// rating period sorts first.
//
// Exported for the test: this is pure, and reaching it through extractDuels
// would mean a D1 fixture to exercise a merge rule.
export function mergeDuels(
	tournament: readonly ResolvedDuel[],
	casual: readonly ResolvedDuel[],
	stats: DuelExtraction["stats"],
): ResolvedDuel[] {
	const byKey = new Map<string, ResolvedDuel>();
	for (const d of tournament) {
		if (d.date) byKey.set(d.key, d);
	}
	for (const d of casual) {
		if (!d.date) continue;
		const existing = byKey.get(d.key);
		if (existing) {
			if (!existing.script && d.script) existing.script = d.script;
			stats.deduped += 1;
			continue;
		}
		byKey.set(d.key, d);
	}
	return [...byKey.values()];
}

// Every ratable duel in D1, de-duplicated by key.
export async function extractDuels(db: D1Database): Promise<DuelExtraction> {
	const stats: DuelExtraction["stats"] = {
		tournament: 0,
		casual: 0,
		deduped: 0,
		casualGamesScanned: 0,
		unresolvedOpponent: 0,
		ambiguousOnlineId: 0,
	};

	const onlineIds = await loadOnlineIdIndex(db);
	const tournament = await tournamentDuels(db);
	const casual = await casualDuels(db, onlineIds, stats);
	stats.tournament = tournament.length;
	stats.casual = casual.length;

	return { duels: mergeDuels(tournament, casual, stats), stats };
}
