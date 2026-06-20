// Pure planner for a fully-formed local test tournament.
//
// Given a few options, `planSeededTournament` simulates a tournament through
// the *same* logic the Worker uses — Swiss pairing, standings/qualification,
// championship bracket construction, and map assignment — and returns a plain
// in-memory plan (`SeedPlan`) of every row to insert. No D1, no I/O: the CLI
// writer (scripts/admin/commands/tournament.ts) turns the plan into SQL.
//
// Reusing the Worker's pure modules keeps the fixture faithful to real
// invariants (21-char IDs come from the injected id factory; bye snapshots and
// map-seed strings match the handlers byte-for-byte). The only thing this adds
// over the Worker is a deterministic outcome rule: the better seed wins every
// decided match, so the whole tournament is reproducible.

import {
	buildChampionshipFollowupRound,
	buildChampionshipRound1,
} from "./bracket";
import { CANONICAL_MAP_SCRIPTS } from "./canonical-maps";
import { assignMapsToPairings } from "./maps";
import { type Pairing, pairSwissRound } from "./pairing";
import { computeStandings, rankStandings } from "./standings";
import type {
	Division,
	MapPoolEntry,
	MatchRef,
	MatchStatus,
	Phase,
	SlotRef,
	TournamentConfig,
} from "./types";

// ---------------------------------------------------------------------------
// Plan shapes — one object per row, columns named to match the D1 schema. The
// writer maps these straight onto INSERT statements.
// ---------------------------------------------------------------------------

export interface SeedTournamentRow {
	tournament_id: string;
	slug: string;
	name: string;
	description: string | null;
	status: "swiss" | "championship" | "complete";
	division_a_name: string;
	division_b_name: string;
	swiss_wins_to_advance: number;
	swiss_losses_to_eliminate: number;
	swiss_max_rounds: number;
	map_pool: MapPoolEntry[];
	completed: boolean; // → completed_at = datetime('now') when true
}

// Fixture account backing a claimed slot. user_id is slug-namespaced
// (`seed-<slug>-<n>`) so re-seeding can idempotently delete prior fixture
// users without touching real (dev-login) accounts; discord_id is a fake but
// numeric snowflake — buildAvatarUrl BigInt-parses it for the default-avatar
// index, so it must stay numeric.
export interface SeedUserRow {
	user_id: string;
	discord_id: string;
	discord_username: string;
	display_name: string;
}

export interface SeedSlotRow {
	slot_id: string;
	phase: Phase;
	division: Division | null;
	swiss_seed: number | null;
	championship_seed: number | null;
	discord_username: string;
	// Claim state. Most fixture slots are claimed by a SeedUserRow so the UI
	// exercises the display-name path (users.display_name); the last seed per
	// division stays unclaimed to exercise the stored-name fallback.
	discord_id: string | null;
	user_id: string | null;
}

export interface SeedRoundRow {
	round_id: string;
	phase: Phase;
	division: Division | null;
	round_number: number;
	status: "in_progress" | "complete"; // generated rounds are never 'pending' here
}

export interface SeedMatchRow {
	match_id: string;
	round_id: string;
	slot_a_id: string;
	slot_b_id: string | null;
	map_pool_id: string | null;
	map_script: string | null;
	pick_order_winner_slot_id: string | null;
	status: MatchStatus;
	winner_slot_id: string | null;
	match_index: number;
	slot_a_username: string | null;
	slot_b_username: string | null;
	// Occupant user_id snapshots (migration 0024), set alongside the username
	// snapshots on decided matches. Null for unclaimed occupants — the read
	// path then falls back to the username snapshot, same as production.
	slot_a_user_id: string | null;
	slot_b_user_id: string | null;
}

export interface SeedPlan {
	tournament: SeedTournamentRow;
	users: SeedUserRow[];
	slots: SeedSlotRow[];
	rounds: SeedRoundRow[];
	matches: SeedMatchRow[];
	// Summary for the CLI to print.
	summary: {
		fill: FillStage;
		swissPlayers: number;
		qualifiers: number;
		bracketSize: number;
		byeCount: number;
	};
}

export type FillStage =
	| "mid-swiss"
	| "swiss-done"
	| "mid-championship"
	| "complete";

export interface SeedOptions {
	slug: string;
	name?: string;
	playersPerDivision?: number; // default 8
	qualifiers?: number; // championship field; non-power-of-2 → byes. default 6
	fill?: FillStage; // default "mid-championship"
	config?: Partial<TournamentConfig>;
	mapPool?: MapPoolEntry[]; // default: first 4 canonical scripts
}

// Human-ish display names so the bracket reads naturally. Cycled with a numeric
// suffix if a fixture needs more than this many players.
const NAMES = [
	"Athena",
	"Boreas",
	"Cyrus",
	"Darius",
	"Esarhaddon",
	"Fabius",
	"Gilgamesh",
	"Hannibal",
	"Iphicrates",
	"Jugurtha",
	"Kambyses",
	"Leonidas",
	"Masinissa",
	"Nebuchadnezzar",
	"Onesimos",
	"Pyrrhus",
	"Quintus",
	"Ramses",
	"Sargon",
	"Tiglath",
	"Ursa",
	"Vercingetorix",
	"Wulfric",
	"Xerxes",
	"Yamhad",
	"Zenobia",
	"Ashurbanipal",
	"Belshazzar",
	"Croesus",
	"Demetrios",
	"Eumenes",
	"Flaminius",
	"Gylippos",
	"Hamilcar",
	"Idrimi",
	"Jason",
];

function playerName(globalIndex: number): string {
	const base = NAMES[globalIndex % NAMES.length];
	const wrap = Math.floor(globalIndex / NAMES.length);
	return wrap === 0 ? base : `${base} ${wrap + 1}`;
}

// Discord-handle-style counterpart to playerName ("Athena" → "athena_0").
// Deliberately divergent from the display name so a label accidentally
// rendered from the stored handle instead of users.display_name is visible
// at a glance in local testing.
function playerHandle(globalIndex: number): string {
	return `${playerName(globalIndex).toLowerCase().replace(/\s+/g, "_")}_${globalIndex}`;
}

// FNV-1a 32-bit — tiny deterministic hash for namespacing fake discord_ids
// per slug.
function fnv1a32(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

// Fake-but-numeric Discord snowflake, unique per (slug, player) — 1000
// players of headroom per slug hash before adjacent slugs could collide,
// far beyond any fixture. Numeric because buildAvatarUrl BigInt-parses
// discord_id for the default-avatar index.
function seedDiscordId(slug: string, globalIndex: number): string {
	return String(
		9_000_000_000_000_000_000n +
			BigInt(fnv1a32(slug)) * 1_000n +
			BigInt(globalIndex),
	);
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export function planSeededTournament(
	opts: SeedOptions,
	makeId: () => string,
): SeedPlan {
	const fill: FillStage = opts.fill ?? "mid-championship";
	const playersPerDivision = opts.playersPerDivision ?? 8;
	const qualifiers = opts.qualifiers ?? 6;
	const name = opts.name ?? opts.slug;
	const config: TournamentConfig = {
		swiss_wins_to_advance: opts.config?.swiss_wins_to_advance ?? 3,
		swiss_losses_to_eliminate: opts.config?.swiss_losses_to_eliminate ?? 3,
		swiss_max_rounds: opts.config?.swiss_max_rounds ?? 5,
	};

	if (playersPerDivision < 2) {
		throw new Error(
			`playersPerDivision must be ≥ 2 (got ${playersPerDivision})`,
		);
	}
	const totalPlayers = playersPerDivision * 2;
	const reachesChampionship =
		fill === "mid-championship" || fill === "complete";
	if (reachesChampionship) {
		if (qualifiers < 2) {
			throw new Error(`qualifiers must be ≥ 2 (got ${qualifiers})`);
		}
		if (qualifiers > totalPlayers) {
			throw new Error(
				`qualifiers (${qualifiers}) exceeds total players (${totalPlayers})`,
			);
		}
	}

	const mapPool: MapPoolEntry[] =
		opts.mapPool ??
		CANONICAL_MAP_SCRIPTS.slice(0, 4).map((script) => ({
			id: makeId(),
			script,
			options: {},
		}));

	const tournamentId = makeId();

	// Mutable accumulators.
	const users: SeedUserRow[] = [];
	const slots: SeedSlotRow[] = [];
	const rounds: SeedRoundRow[] = [];
	const matches: SeedMatchRow[] = [];
	// Refs for the pure algorithms — decided matches only (complete/bye). Pending
	// matches contribute nothing to records and would confuse anti-repeat.
	const refs: MatchRef[] = [];
	// slot_id → stored name (the @handle for claimed slots — what the username
	// snapshots record, mirroring production), → claiming user_id (for the
	// user-id snapshots), and → seed (swiss or championship, by phase).
	const nameBySlot = new Map<string, string>();
	const userIdBySlot = new Map<string, string | null>();
	const swissSeedBySlot = new Map<string, number>();
	const champSeedBySlot = new Map<string, number>();

	// --- Swiss slots, two divisions, seeds 1..N each ---
	// Every seed except the last per division is claimed by a fixture user
	// whose display_name differs from the handle, so the UI's display-name
	// path and the unclaimed stored-name fallback are both visible locally.
	const divisions: Division[] = ["A", "B"];
	const swissSlotsByDivision: Record<Division, SlotRef[]> = { A: [], B: [] };
	let globalIndex = 0;
	for (const division of divisions) {
		for (let seed = 1; seed <= playersPerDivision; seed++) {
			const slotId = makeId();
			const handle = playerHandle(globalIndex);
			const claimed = seed < playersPerDivision;
			let userId: string | null = null;
			let discordId: string | null = null;
			if (claimed) {
				userId = `seed-${opts.slug}-${globalIndex}`;
				discordId = seedDiscordId(opts.slug, globalIndex);
				users.push({
					user_id: userId,
					discord_id: discordId,
					discord_username: handle,
					display_name: playerName(globalIndex),
				});
			}
			slots.push({
				slot_id: slotId,
				phase: "swiss",
				division,
				swiss_seed: seed,
				championship_seed: null,
				discord_username: handle,
				discord_id: discordId,
				user_id: userId,
			});
			nameBySlot.set(slotId, handle);
			userIdBySlot.set(slotId, userId);
			swissSeedBySlot.set(slotId, seed);
			swissSlotsByDivision[division].push({
				slot_id: slotId,
				phase: "swiss",
				division,
				swiss_seed: seed,
				championship_seed: null,
				withdrawn: false,
			});
			globalIndex++;
		}
	}

	// --- Simulate the Swiss phase per division ---
	// Each division's rounds are recorded; for mid-swiss we leave the last
	// generated round pending afterwards.
	const swissRoundIdsByDivision: Record<Division, string[]> = { A: [], B: [] };
	for (const division of divisions) {
		const divSlots = swissSlotsByDivision[division];
		for (
			let roundNumber = 1;
			roundNumber <= config.swiss_max_rounds;
			roundNumber++
		) {
			const pairings = pairSwissRound(divSlots, refs, roundNumber, config);
			if (pairings.length === 0) break; // everyone advanced/eliminated
			const roundId = makeId();
			swissRoundIdsByDivision[division].push(roundId);
			rounds.push({
				round_id: roundId,
				phase: "swiss",
				division,
				round_number: roundNumber,
				status: "complete",
			});
			emitDecidedRound({
				roundId,
				roundNumber,
				phase: "swiss",
				division,
				pairings,
				pool: mapPool,
				mapSeed: `${tournamentId}|swiss|${division}|r${roundNumber}`,
				seedBySlot: swissSeedBySlot,
				nameBySlot,
				userIdBySlot,
				matches,
				refs,
				makeId,
			});
		}
	}

	// For mid-swiss: undo the decision on the last generated round per division —
	// flip its real matches back to pending and the round to in_progress.
	if (fill === "mid-swiss") {
		for (const division of divisions) {
			const ids = swissRoundIdsByDivision[division];
			if (ids.length === 0) continue;
			const lastRoundId = ids[ids.length - 1];
			makeRoundPending(lastRoundId, rounds, matches, refs);
		}
	}

	const tournamentStatus: SeedTournamentRow["status"] = reachesChampionship
		? fill === "complete"
			? "complete"
			: "championship"
		: "swiss";

	// --- Championship phase ---
	let bracketSize = 0;
	let byeCount = 0;
	if (reachesChampionship) {
		// Qualifier selection: combined ranking across both divisions, take top N
		// (mirrors the real transition's override_ranks path).
		const allSwissRefs = refs.filter((r) => r.phase === "swiss");
		const allSwissSlotRefs: SlotRef[] = slots
			.filter((s) => s.phase === "swiss")
			.map((s) => ({
				slot_id: s.slot_id,
				phase: "swiss",
				division: s.division,
				swiss_seed: s.swiss_seed,
				championship_seed: null,
				withdrawn: false,
			}));
		const standings = computeStandings(allSwissSlotRefs, allSwissRefs, config);
		const ranked = rankStandings(standings, allSwissRefs);
		const seedOrder = ranked.slice(0, qualifiers).map((r) => r.slot_id);

		// Championship slots: seeds 1..N, identity (stored name + claim state)
		// copied from the source Swiss slot.
		const champSlotIdBySeed: Record<number, string> = {};
		seedOrder.forEach((sourceSlotId, i) => {
			const seed = i + 1;
			const slotId = makeId();
			const source = slots.find((s) => s.slot_id === sourceSlotId);
			const username =
				source?.discord_username ??
				nameBySlot.get(sourceSlotId) ??
				playerHandle(i);
			slots.push({
				slot_id: slotId,
				phase: "championship",
				division: null,
				swiss_seed: null,
				championship_seed: seed,
				discord_username: username,
				discord_id: source?.discord_id ?? null,
				user_id: source?.user_id ?? null,
			});
			nameBySlot.set(slotId, username);
			userIdBySlot.set(slotId, source?.user_id ?? null);
			champSeedBySlot.set(slotId, seed);
			champSlotIdBySeed[seed] = slotId;
		});

		const round1 = buildChampionshipRound1(qualifiers);
		bracketSize = round1.bracket_size;
		byeCount = round1.bye_count;

		// Round 1 — built from the bracket template. mid-championship leaves the
		// last *real* match pending when R1 is already the semifinal-or-smaller
		// round (≤2 matches); otherwise R1 is fully decided.
		const r1Pairings: Pairing[] = round1.matches.map((t) => ({
			slot_a_id: champSlotIdBySeed[t.seed_a],
			slot_b_id: t.is_bye ? null : champSlotIdBySeed[t.seed_b],
		}));
		const r1Id = makeId();
		const r1Partial = fill === "mid-championship" && round1.matches.length <= 2;
		rounds.push({
			round_id: r1Id,
			phase: "championship",
			division: null,
			round_number: 1,
			status: r1Partial ? "in_progress" : "complete",
		});
		emitDecidedRound({
			roundId: r1Id,
			roundNumber: 1,
			phase: "championship",
			division: null,
			pairings: r1Pairings,
			pool: mapPool,
			mapSeed: `${tournamentId}|championship|r1`,
			seedBySlot: champSeedBySlot,
			nameBySlot,
			userIdBySlot,
			matches,
			refs,
			makeId,
			pendingLastReal: r1Partial,
		});

		// Follow-up rounds: pair adjacent winners of the prior round. Stop when the
		// prior round was left partial, or — for mid-championship — at the
		// semifinal round (≤2 matches), which we leave partial.
		let priorRoundId = r1Id;
		let priorMatchCount = round1.matches.length;
		let priorPartial = r1Partial;
		let roundNumber = 2;
		while (!priorPartial && priorMatchCount > 1) {
			const templates = buildChampionshipFollowupRound(priorMatchCount);
			const priorMatches = matches
				.filter((m) => m.round_id === priorRoundId)
				.sort((a, b) => a.match_index - b.match_index);
			const pairings: Pairing[] = templates.map((t) => ({
				slot_a_id: priorMatches[t.source_match_a_index - 1].winner_slot_id!,
				slot_b_id: priorMatches[t.source_match_b_index - 1].winner_slot_id!,
			}));
			const roundId = makeId();
			// This round is partial when mid-championship and it's the semifinal
			// (≤2 matches). The final (1 match) under mid-championship is also
			// partial — it never gets fully decided.
			const partial = fill === "mid-championship" && pairings.length <= 2;
			rounds.push({
				round_id: roundId,
				phase: "championship",
				division: null,
				round_number: roundNumber,
				status: partial ? "in_progress" : "complete",
			});
			emitDecidedRound({
				roundId,
				roundNumber,
				phase: "championship",
				division: null,
				pairings,
				pool: mapPool,
				mapSeed: `${tournamentId}|championship|r${roundNumber}`,
				seedBySlot: champSeedBySlot,
				nameBySlot,
				userIdBySlot,
				matches,
				refs,
				makeId,
				pendingLastReal: partial,
			});
			priorRoundId = roundId;
			priorMatchCount = pairings.length;
			priorPartial = partial;
			roundNumber++;
		}
	}

	const tournament: SeedTournamentRow = {
		tournament_id: tournamentId,
		slug: opts.slug,
		name,
		description: `Local seed fixture (fill=${fill}).`,
		status: tournamentStatus,
		division_a_name: "Division A",
		division_b_name: "Division B",
		swiss_wins_to_advance: config.swiss_wins_to_advance,
		swiss_losses_to_eliminate: config.swiss_losses_to_eliminate,
		swiss_max_rounds: config.swiss_max_rounds,
		map_pool: mapPool,
		completed: fill === "complete",
	};

	return {
		tournament,
		users,
		slots,
		rounds,
		matches,
		summary: {
			fill,
			swissPlayers: totalPlayers,
			qualifiers: reachesChampionship ? qualifiers : 0,
			bracketSize,
			byeCount,
		},
	};
}

// ---------------------------------------------------------------------------
// Round emission
// ---------------------------------------------------------------------------

interface EmitRoundArgs {
	roundId: string;
	roundNumber: number;
	phase: Phase;
	division: Division | null;
	pairings: Pairing[];
	pool: MapPoolEntry[];
	mapSeed: string;
	seedBySlot: Map<string, number>;
	nameBySlot: Map<string, string>;
	userIdBySlot: Map<string, string | null>;
	matches: SeedMatchRow[];
	refs: MatchRef[];
	makeId: () => string;
	// When true, the highest-index *real* (non-bye) match is left pending —
	// used to render a round that's under way but not finished.
	pendingLastReal?: boolean;
}

// Build one round's match rows. Byes auto-advance slot_a; real matches are
// decided by the better seed (lower seed number wins), with both occupants
// snapshotted — except an optional trailing real match left pending.
function emitDecidedRound(args: EmitRoundArgs): void {
	const withMaps = assignMapsToPairings(
		args.pairings,
		args.pool,
		args.refs,
		args.mapSeed,
	);

	// Index of the last real (non-bye) pairing, for the pendingLastReal case.
	let lastRealIndex = -1;
	for (let i = 0; i < withMaps.length; i++) {
		if (withMaps[i].slot_b_id !== null) lastRealIndex = i;
	}

	for (let i = 0; i < withMaps.length; i++) {
		const p = withMaps[i];
		const matchId = args.makeId();
		const isBye = p.slot_b_id === null;
		const leavePending = args.pendingLastReal === true && i === lastRealIndex;
		const aName = args.nameBySlot.get(p.slot_a_id) ?? null;
		const bName = p.slot_b_id
			? (args.nameBySlot.get(p.slot_b_id) ?? null)
			: null;

		let status: MatchStatus;
		let winner: string | null;
		if (isBye) {
			status = "bye";
			winner = p.slot_a_id;
		} else if (leavePending) {
			status = "pending";
			winner = null;
		} else {
			status = "complete";
			winner = betterSeedWinner(p.slot_a_id, p.slot_b_id!, args.seedBySlot);
		}

		const decided = status === "complete" || status === "bye";
		args.matches.push({
			match_id: matchId,
			round_id: args.roundId,
			slot_a_id: p.slot_a_id,
			slot_b_id: p.slot_b_id,
			map_pool_id: p.map_pool_id,
			map_script: p.map_script,
			// Real matches default pick order to slot_b (player listed second picks
			// first); byes have no pick order.
			pick_order_winner_slot_id: isBye ? null : p.slot_b_id,
			status,
			winner_slot_id: winner,
			match_index: i + 1,
			// Snapshot occupants on decided matches only; pending resolve live.
			slot_a_username: decided ? aName : null,
			slot_b_username: decided ? bName : null,
			slot_a_user_id: decided
				? (args.userIdBySlot.get(p.slot_a_id) ?? null)
				: null,
			slot_b_user_id:
				decided && p.slot_b_id
					? (args.userIdBySlot.get(p.slot_b_id) ?? null)
					: null,
		});

		if (decided) {
			args.refs.push({
				match_id: matchId,
				round_id: args.roundId,
				round_number: args.roundNumber,
				phase: args.phase,
				division: args.division,
				slot_a_id: p.slot_a_id,
				slot_b_id: p.slot_b_id,
				map_pool_id: p.map_pool_id,
				map_script: p.map_script,
				status,
				winner_slot_id: winner,
			});
		}
	}
}

// The better seed (lower seed number) wins. Falls back to slot_a if a seed is
// somehow missing (shouldn't happen).
function betterSeedWinner(
	a: string,
	b: string,
	seedBySlot: Map<string, number>,
): string {
	const sa = seedBySlot.get(a) ?? Infinity;
	const sb = seedBySlot.get(b) ?? Infinity;
	return sa <= sb ? a : b;
}

// Flip a fully-decided round back to in_progress with its real matches pending
// (byes stay decided). Used for the mid-swiss cutoff. Removes the un-decided
// matches from `refs` so standings/pairing no longer count them.
function makeRoundPending(
	roundId: string,
	rounds: SeedRoundRow[],
	matches: SeedMatchRow[],
	refs: MatchRef[],
): void {
	const round = rounds.find((r) => r.round_id === roundId);
	if (round) round.status = "in_progress";
	for (const m of matches) {
		if (m.round_id !== roundId) continue;
		if (m.status === "bye") continue; // byes can't be "un-played"
		m.status = "pending";
		m.winner_slot_id = null;
		m.slot_a_username = null;
		m.slot_b_username = null;
		m.slot_a_user_id = null;
		m.slot_b_user_id = null;
	}
	// Drop this round's now-pending matches from the algorithm refs.
	for (let i = refs.length - 1; i >= 0; i--) {
		if (refs[i].round_id === roundId && refs[i].status !== "bye") {
			refs.splice(i, 1);
		}
	}
}
