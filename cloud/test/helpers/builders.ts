// Test data builders. Tests read at a glance because builders absorb setup
// noise. Composable, strongly typed, no `any`.
//
// Builders use real handler calls (via SELF.fetch) where possible — direct
// SQL would silently drift from production behavior. The exceptions are:
//   1. Tournament creation: no API endpoint (CLI-only). Direct INSERT
//      mirrors scripts/admin/commands/tournament.ts.
//   2. Slot claiming: no test-friendly endpoint (real flow is OAuth
//      first-login matching). Direct UPDATE on user_id.
//
// Session seeding mirrors createSession in cloud/src/session.ts.

import { env } from "cloudflare:test";
import { nanoid } from "nanoid";
import type {
	MatchRow,
	RoundRow,
	SlotRow,
	TournamentRow,
} from "../../src/tournament/data";
import { expectOk } from "./assertions";
import { request } from "./requests";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days, matches session.ts

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface TestUser {
	readonly userId: string;
	readonly discordId: string;
	readonly discordUsername: string;
	readonly sessionToken: string;
}

let discordIdCounter = 1_000_000_000_000_000_000n;

export async function makeUser(opts?: {
	discordUsername?: string;
}): Promise<TestUser> {
	const userId = nanoid(21);
	// Snowflake-looking but deterministic-enough for test debugging.
	const discordId = String(discordIdCounter++);
	const discordUsername =
		opts?.discordUsername ?? `user-${nanoid(8).toLowerCase()}`;

	await env.SHARE_DB.prepare(
		`INSERT INTO users (user_id, discord_id, display_name) VALUES (?, ?, ?)`,
	)
		.bind(userId, discordId, discordUsername)
		.run();

	const sessionToken = nanoid(32);
	await env.SESSIONS_KV.put(
		`session:${sessionToken}`,
		JSON.stringify({ user_id: userId, discord_username: discordUsername }),
		{ expirationTtl: SESSION_TTL_SECONDS },
	);

	return { userId, discordId, discordUsername, sessionToken };
}

// ---------------------------------------------------------------------------
// Tournaments
// ---------------------------------------------------------------------------

export interface TestSlot {
	readonly slotId: string;
	readonly division: "A" | "B";
	readonly swissSeed: number;
	readonly discordUsername: string;
	readonly owner: TestUser | null;
}

// "setup" — slots in place, no rounds yet (admin hasn't clicked Start).
// "swiss-round-1-generated" — admin pressed Start; Round 1 exists in_progress
//   for both divisions with all matches pending.
// "swiss-round-1-reported" — all Round 1 matches reported. With auto-advance
//   this implicitly closes Round 1 and generates Round 2 for both divisions.
export type TournamentPhase =
	| "setup"
	| "swiss-round-1-generated"
	| "swiss-round-1-reported";

export interface TestTournament {
	readonly tournamentId: string;
	readonly slug: string;
	readonly admin: TestUser;
	readonly slotsByDivision: Readonly<{
		A: readonly TestSlot[];
		B: readonly TestSlot[];
	}>;
	refresh(): Promise<TournamentRow>;
	rounds(): Promise<readonly RoundRow[]>;
	matches(): Promise<readonly MatchRow[]>;
}

export interface MakeTournamentOpts {
	readonly admin?: TestUser;
	readonly slug?: string;
	readonly name?: string;
	readonly slotsPerDivision?: number; // default 4
	readonly slotOwners?: {
		readonly A?: readonly TestUser[];
		readonly B?: readonly TestUser[];
	};
	readonly allowedMaps?: readonly string[]; // default ["MAP_SEASIDE", "MAP_RIVER"]
	readonly advanceTo?: TournamentPhase; // default "setup"
}

export async function makeTournament(
	opts: MakeTournamentOpts = {},
): Promise<TestTournament> {
	const admin = opts.admin ?? (await makeUser());
	const tournamentId = nanoid(21);
	const slug = opts.slug ?? `t-${nanoid(8).toLowerCase()}`;
	const name = opts.name ?? `Test Tournament ${slug}`;
	const slotsPerDivision = opts.slotsPerDivision ?? 4;
	const allowedMaps = opts.allowedMaps ?? ["MAP_SEASIDE", "MAP_RIVER"];
	const advanceTo: TournamentPhase = opts.advanceTo ?? "setup";

	// 1) Direct INSERT (no API endpoint for tournament creation).
	await env.SHARE_DB.prepare(
		`INSERT INTO tournaments
		   (tournament_id, slug, name, status, allowed_map_scripts)
		 VALUES (?, ?, ?, 'setup', ?)`,
	)
		.bind(tournamentId, slug, name, JSON.stringify(allowedMaps))
		.run();
	await env.SHARE_DB.prepare(
		`INSERT INTO tournament_admins (tournament_id, user_id) VALUES (?, ?)`,
	)
		.bind(tournamentId, admin.userId)
		.run();

	// 2) Bulk-create slots via the handler.
	const ownersA = opts.slotOwners?.A ?? [];
	const ownersB = opts.slotOwners?.B ?? [];
	const slotPayload: { division: "A" | "B"; discord_username: string }[] = [];
	for (let i = 0; i < slotsPerDivision; i++) {
		slotPayload.push({
			division: "A",
			discord_username:
				ownersA[i]?.discordUsername ?? `a${i + 1}-${nanoid(6).toLowerCase()}`,
		});
		slotPayload.push({
			division: "B",
			discord_username:
				ownersB[i]?.discordUsername ?? `b${i + 1}-${nanoid(6).toLowerCase()}`,
		});
	}
	await expectOk(
		await request.post({
			path: `/v1/tournaments/${tournamentId}/slots`,
			as: admin,
			body: slotPayload,
		}),
	);

	// 3) Direct UPDATE to claim slots whose username matches a provided owner.
	//    Production claims happen at OAuth login; we shortcut.
	const ownerByUsername = new Map<string, TestUser>();
	for (const u of [...ownersA, ...ownersB]) {
		ownerByUsername.set(u.discordUsername, u);
	}
	if (ownerByUsername.size > 0) {
		const rows =
			(
				await env.SHARE_DB.prepare(
					`SELECT slot_id, discord_username FROM tournament_slots
				   WHERE tournament_id = ?`,
				)
					.bind(tournamentId)
					.all<{ slot_id: string; discord_username: string }>()
			).results ?? [];
		for (const row of rows) {
			const owner = ownerByUsername.get(row.discord_username);
			if (!owner) continue;
			await env.SHARE_DB.prepare(
				`UPDATE tournament_slots SET user_id = ?, discord_id = ?
				 WHERE slot_id = ?`,
			)
				.bind(owner.userId, owner.discordId, row.slot_id)
				.run();
		}
	}

	// 4) Read back slots, build TestSlot[].
	const finalRows =
		(
			await env.SHARE_DB.prepare(
				`SELECT * FROM tournament_slots
			   WHERE tournament_id = ? AND phase = 'swiss'
			   ORDER BY division, swiss_seed`,
			)
				.bind(tournamentId)
				.all<SlotRow>()
		).results ?? [];

	const slotsByDivision: { A: TestSlot[]; B: TestSlot[] } = { A: [], B: [] };
	for (const row of finalRows) {
		if (row.division !== "A" && row.division !== "B") {
			throw new Error(
				`Slot ${row.slot_id} has unexpected division ${row.division}`,
			);
		}
		if (row.swiss_seed == null) {
			throw new Error(`Slot ${row.slot_id} has null swiss_seed`);
		}
		if (row.discord_username == null) {
			throw new Error(`Slot ${row.slot_id} has null discord_username`);
		}
		slotsByDivision[row.division].push({
			slotId: row.slot_id,
			division: row.division,
			swissSeed: row.swiss_seed,
			discordUsername: row.discord_username,
			owner: row.user_id
				? (ownerByUsername.get(row.discord_username) ?? null)
				: null,
		});
	}

	const t: TestTournament = {
		tournamentId,
		slug,
		admin,
		slotsByDivision,
		refresh: () => loadTournamentRow(tournamentId),
		rounds: () => loadRoundsForTournament(tournamentId),
		matches: () => loadMatchesForTournament(tournamentId),
	};

	// 5) Advance through phases using real handlers.
	if (advanceTo === "setup") return t;

	// /start does setup → swiss + Round 1 (in_progress) for both divisions
	// atomically. The deprecated /start-swiss + per-division /rounds +
	// /rounds/:id/start trio collapsed into this single endpoint.
	await expectOk(
		await request.post({
			path: `/v1/tournaments/${tournamentId}/start`,
			as: admin,
		}),
	);
	if (advanceTo === "swiss-round-1-generated") return t;

	// Report all round-1 matches; slot_a wins for determinism. The last
	// pending match's retro-edit fires auto-advance, which closes Round 1
	// and generates Round 2 in that division.
	const round1Matches = await t.matches();
	for (const m of round1Matches) {
		if (m.status === "bye") continue;
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${tournamentId}/matches/${m.match_id}`,
				as: admin,
				body: { winner_slot_id: m.slot_a_id, status: "reported" },
			}),
		);
	}
	return t;
}

// ---------------------------------------------------------------------------
// Internal row loaders (also exposed via TestTournament accessors)
// ---------------------------------------------------------------------------

async function loadTournamentRow(tournamentId: string): Promise<TournamentRow> {
	const row = await env.SHARE_DB.prepare(
		`SELECT * FROM tournaments WHERE tournament_id = ?`,
	)
		.bind(tournamentId)
		.first<TournamentRow>();
	if (!row) throw new Error(`Tournament ${tournamentId} not found`);
	return row;
}

async function loadRoundsForTournament(
	tournamentId: string,
): Promise<RoundRow[]> {
	const res = await env.SHARE_DB.prepare(
		`SELECT * FROM tournament_rounds WHERE tournament_id = ?
		 ORDER BY phase, division, round_number`,
	)
		.bind(tournamentId)
		.all<RoundRow>();
	return res.results ?? [];
}

async function loadMatchesForTournament(
	tournamentId: string,
): Promise<MatchRow[]> {
	const res = await env.SHARE_DB.prepare(
		`SELECT m.* FROM tournament_matches m
		 JOIN tournament_rounds r ON r.round_id = m.round_id
		 WHERE r.tournament_id = ?
		 ORDER BY r.phase, r.division, r.round_number, m.match_index, m.created_at`,
	)
		.bind(tournamentId)
		.all<MatchRow>();
	return res.results ?? [];
}
