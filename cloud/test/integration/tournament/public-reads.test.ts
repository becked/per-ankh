// Response-shape assertions for the 8 public-shaped tournament handlers
// in cloud/src/tournament/public.ts and the game-tournament-link helper.
// The current suite hits some of these for rate-limit/ordering side
// effects but never asserts the body shape — a refactor that drops a
// documented field would slip through. This file pins each handler's
// contract.
//
// While the beta is on, the "public" handlers require a session + beta
// membership. Every test caller in this file goes through `t.admin`
// (which makeTournament beta-seeds by default).

import { applyD1Migrations, env } from "cloudflare:test";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk } from "../../helpers/assertions";
import {
	makeTournament,
	makeUser,
	type TestTournament,
} from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

describe("public read handlers", () => {
	it("GET /v1/tournaments returns a list of tournament summary rows", async () => {
		const t = await makeTournament({ name: "Shape List Cup" });

		const res = await request.get({ path: "/v1/tournaments", as: t.admin });
		const body = await expectOk<{
			tournaments: Array<{
				tournament_id: string;
				slug: string;
				name: string;
				status: string;
				signups_open: boolean;
				created_at: string;
				updated_at: string;
				swiss_wins_to_advance: number;
				swiss_losses_to_eliminate: number;
				swiss_max_rounds: number;
				map_pool_size: number;
				player_count: number;
				active_round: {
					round_number: number;
					matches_total: number;
					matches_reported: number;
				} | null;
				champion: { display_name: string; avatar_url: string | null } | null;
			}>;
			limit: number;
			offset: number;
		}>(res);

		expect(body.limit).toBeGreaterThan(0);
		expect(body.offset).toBe(0);
		const row = body.tournaments.find(
			(r) => r.tournament_id === t.tournamentId,
		);
		expect(row).toBeDefined();
		expect(row?.slug).toBe(t.slug);
		expect(row?.name).toBe("Shape List Cup");
		expect(row?.status).toBe("setup");
		expect(typeof row?.created_at).toBe("string");
		expect(typeof row?.updated_at).toBe("string");
		// New aggregate fields the /tournaments list card relies on. Setup-phase
		// tournament with no rounds yet → no active round and no champion.
		expect(row?.map_pool_size).toBe(2); // makeTournament defaults to 2 maps
		expect(row?.player_count).toBe(8); // 4 slots × 2 divisions
		expect(row?.active_round).toBeNull();
		expect(row?.champion).toBeNull();
		expect(typeof row?.swiss_wins_to_advance).toBe("number");
		expect(typeof row?.swiss_losses_to_eliminate).toBe("number");
		expect(typeof row?.swiss_max_rounds).toBe("number");
	});

	it("GET /v1/tournaments/:slug returns the full tournament detail shape", async () => {
		const t = await makeTournament({ name: "Detail Cup" });

		const res = await request.get({
			path: `/v1/tournaments/${t.slug}`,
			as: t.admin,
		});
		const body = await expectOk<{
			tournament_id: string;
			slug: string;
			name: string;
			description: string | null;
			status: string;
			division_a_name: string;
			division_b_name: string;
			swiss_wins_to_advance: number;
			swiss_losses_to_eliminate: number;
			swiss_max_rounds: number;
			map_pool: {
				id: string;
				script: string;
				options: Record<string, string | boolean>;
			}[];
			slot_counts: { swiss: number; championship: number };
			is_viewer_admin: boolean;
			owner: { display_name: string; avatar_url: string } | null;
			admins: { display_name: string; avatar_url: string }[];
			starts_at: string | null;
			completed_at: string | null;
			created_at: string;
			updated_at: string;
		}>(res);

		expect(body.tournament_id).toBe(t.tournamentId);
		expect(body.slug).toBe(t.slug);
		expect(body.name).toBe("Detail Cup");
		expect(body.status).toBe("setup");
		expect(body.map_pool.map((e) => e.script)).toEqual([
			"MAP_SEASIDE",
			"MAP_RIVER",
		]);
		// Default 4 slots per division from makeTournament.
		expect(body.slot_counts.swiss).toBe(8);
		expect(body.slot_counts.championship).toBe(0);
		// Caller is the tournament admin — affordances flagged on.
		expect(body.is_viewer_admin).toBe(true);
		// The creator is the owner (sole admin → empty co-admin list). Both
		// schedule dates are unset for a fresh setup-phase tournament.
		expect(body.owner).not.toBeNull();
		expect(typeof body.owner?.display_name).toBe("string");
		expect(typeof body.owner?.avatar_url).toBe("string");
		expect(body.admins).toEqual([]);
		expect(body.starts_at).toBeNull();
		expect(body.completed_at).toBeNull();
	});

	it("GET /v1/tournaments/:id/standings returns ranked standings + combined qualifier ranking", async () => {
		// One claimed slot among unclaimed ones: claimed rows label by the
		// claiming user's display_name, unclaimed rows fall back to the stored
		// name the admin typed (the builder's generated `a1-…` style).
		const alice = await makeUser({ displayName: "Alice The Strategist" });
		const t = await makeTournament({
			advanceTo: "swiss-round-1-complete",
			slotOwners: { A: [alice] },
		});

		const res = await request.get({
			path: `/v1/tournaments/${t.tournamentId}/standings`,
			as: t.admin,
		});
		const body = await expectOk<{
			tournament_id: string;
			divisions: {
				A: {
					name: string;
					standings: Array<{
						slot_id: string;
						rank: number;
						wins: number;
						losses: number;
						buchholz_cut1: number;
						cumulative: number;
						h2h: number;
						display_name: string | null;
						swiss_seed: number | null;
						discord_username: string | null;
					}>;
				};
				B: {
					name: string;
					standings: Array<{
						slot_id: string;
						rank: number;
						wins: number;
						losses: number;
						buchholz_cut1: number;
						cumulative: number;
						h2h: number;
						display_name: string | null;
						swiss_seed: number | null;
						discord_username: string | null;
					}>;
				};
			};
			combined_qualifier_ranking: Array<{
				slot_id: string;
				rank: number;
				wins: number;
				losses: number;
				status: string;
				division: "A" | "B" | null;
				display_name: string | null;
				buchholz_cut1: number;
				cumulative: number;
				h2h: number;
			}>;
		}>(res);

		expect(body.tournament_id).toBe(t.tournamentId);
		expect(body.divisions.A.standings.length).toBe(4);
		expect(body.divisions.B.standings.length).toBe(4);
		for (const row of [
			...body.divisions.A.standings,
			...body.divisions.B.standings,
		]) {
			expect(typeof row.slot_id).toBe("string");
			expect(typeof row.rank).toBe("number");
			expect(typeof row.wins).toBe("number");
			expect(typeof row.losses).toBe("number");
			expect(typeof row.buchholz_cut1).toBe("number");
			expect(typeof row.cumulative).toBe("number");
			expect(typeof row.swiss_seed).toBe("number");
		}
		// After 1 reported swiss round, every match has a winner — so wins
		// + losses sum to 1 for every slot in a 4-player division.
		for (const row of body.divisions.A.standings) {
			expect(row.wins + row.losses).toBe(1);
		}

		// Claimed slot labels by users.display_name, not the handle.
		const aliceSlot = t.slotsByDivision.A.find(
			(s) => s.owner?.userId === alice.userId,
		)!;
		const aliceRow = body.divisions.A.standings.find(
			(r) => r.slot_id === aliceSlot.slotId,
		);
		expect(aliceRow?.display_name).toBe("Alice The Strategist");
		// Unclaimed slot falls back to its stored name.
		const unclaimedSlot = t.slotsByDivision.B[0];
		const unclaimedRow = body.divisions.B.standings.find(
			(r) => r.slot_id === unclaimedSlot.slotId,
		);
		expect(unclaimedRow?.display_name).toBe(unclaimedSlot.discordUsername);

		// Combined qualifier ranking spans both divisions, in seed order, and
		// carries the same display labels.
		expect(body.combined_qualifier_ranking).toBeDefined();
		expect(body.combined_qualifier_ranking.length).toBe(8);
		for (const r of body.combined_qualifier_ranking) {
			expect(["A", "B"]).toContain(r.division);
			expect(["active", "advanced", "eliminated"]).toContain(r.status);
		}
		const combinedAlice = body.combined_qualifier_ranking.find(
			(r) => r.slot_id === aliceSlot.slotId,
		);
		expect(combinedAlice?.display_name).toBe("Alice The Strategist");

		// discord_username is admin-only: the admin viewer sees the raw stored
		// handle (so the slots-panel editor can seed from it); a non-admin beta
		// viewer sees null.
		expect(aliceRow?.discord_username).toBe(aliceSlot.discordUsername);
		const viewer = await makeUser(); // beta member, not a tournament admin
		const publicRes = await request.get({
			path: `/v1/tournaments/${t.tournamentId}/standings`,
			as: viewer,
		});
		const publicBody = await expectOk<{
			divisions: {
				A: {
					standings: Array<{
						slot_id: string;
						discord_username: string | null;
					}>;
				};
			};
		}>(publicRes);
		const alicePublicRow = publicBody.divisions.A.standings.find(
			(r) => r.slot_id === aliceSlot.slotId,
		);
		expect(alicePublicRow).toBeDefined();
		expect(alicePublicRow?.discord_username).toBeNull();
	});

	it("GET /v1/tournaments/:id/bracket returns championship slots + rounds with nested matches", async () => {
		const t = await driveToChampionship();

		const res = await request.get({
			path: `/v1/tournaments/${t.tournamentId}/bracket`,
			as: t.admin,
		});
		const body = await expectOk<{
			tournament_id: string;
			slots: Array<{
				slot_id: string;
				championship_seed: number | null;
				display_name: string | null;
				user_id: string | null;
			}>;
			rounds: Array<{
				round_id: string;
				round_number: number;
				status: string;
				matches: Array<{
					match_id: string;
					slot_a_id: string;
					slot_b_id: string | null;
					status: string;
					winner_slot_id: string | null;
				}>;
			}>;
		}>(res);

		expect(body.tournament_id).toBe(t.tournamentId);
		// 2 advancers per division × 2 divisions = 4 championship slots.
		expect(body.slots.length).toBe(4);
		for (const s of body.slots) {
			expect(typeof s.slot_id).toBe("string");
			expect(typeof s.championship_seed).toBe("number");
			// Unclaimed fixture slots still label via the stored-name fallback.
			expect(typeof s.display_name).toBe("string");
		}
		// Semifinal round was auto-generated by transition-championship.
		expect(body.rounds.length).toBeGreaterThan(0);
		const r1 = body.rounds[0];
		expect(r1.round_number).toBe(1);
		expect(r1.matches.length).toBe(2);
		for (const m of r1.matches) {
			expect(typeof m.match_id).toBe("string");
			expect(typeof m.slot_a_id).toBe("string");
			expect(typeof m.status).toBe("string");
		}
	});

	it("GET /v1/tournaments/:id/rounds returns a flat list of round metadata", async () => {
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
		});

		const res = await request.get({
			path: `/v1/tournaments/${t.tournamentId}/rounds`,
			as: t.admin,
		});
		const body = await expectOk<{
			tournament_id: string;
			rounds: Array<{
				round_id: string;
				tournament_id: string;
				phase: string;
				division: string | null;
				round_number: number;
				status: string;
				generated_at: string | null;
				started_at: string | null;
				completed_at: string | null;
			}>;
		}>(res);

		expect(body.tournament_id).toBe(t.tournamentId);
		// Two divisions × one swiss round each.
		expect(body.rounds.length).toBe(2);
		for (const r of body.rounds) {
			expect(r.tournament_id).toBe(t.tournamentId);
			expect(r.phase).toBe("swiss");
			expect(["A", "B"]).toContain(r.division);
			expect(r.round_number).toBe(1);
			expect(r.status).toBe("in_progress");
		}
	});

	it("GET /v1/tournaments/:id/matches returns matches with round context joined in", async () => {
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
		});

		const res = await request.get({
			path: `/v1/tournaments/${t.tournamentId}/matches`,
			as: t.admin,
		});
		const body = await expectOk<{
			tournament_id: string;
			matches: Array<{
				match_id: string;
				slot_a_id: string;
				slot_b_id: string | null;
				map_script: string | null;
				status: string;
				winner_slot_id: string | null;
				game_id: string | null;
				round_id: string;
				round_number: number;
				phase: string;
				division: string | null;
				slot_a_discord_username: string | null;
				slot_b_discord_username: string | null;
			}>;
		}>(res);

		expect(body.tournament_id).toBe(t.tournamentId);
		// 4 slots / 2 = 2 matches per division × 2 divisions = 4 matches.
		expect(body.matches.length).toBe(4);
		for (const m of body.matches) {
			expect(typeof m.match_id).toBe("string");
			expect(typeof m.slot_a_id).toBe("string");
			expect(m.phase).toBe("swiss");
			expect(["A", "B"]).toContain(m.division);
			expect(m.round_number).toBe(1);
			expect(m.status).toBe("pending");
			// Admin viewer sees each live slot's raw handle (every fixture slot
			// carries a stored name; no byes in a 4-slot division).
			expect(typeof m.slot_a_discord_username).toBe("string");
		}

		// A non-admin beta viewer gets null for the admin-only handle field.
		const viewer = await makeUser();
		const publicRes = await request.get({
			path: `/v1/tournaments/${t.tournamentId}/matches`,
			as: viewer,
		});
		const publicBody = await expectOk<{
			matches: Array<{
				slot_a_discord_username: string | null;
				slot_b_discord_username: string | null;
			}>;
		}>(publicRes);
		for (const m of publicBody.matches) {
			expect(m.slot_a_discord_username).toBeNull();
			expect(m.slot_b_discord_username).toBeNull();
		}
	});

	it("GET /v1/tournaments/:id/matches/:match_id returns a single match with tournament context", async () => {
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
		});
		const target = (await t.matches()).find((m) => m.status === "pending")!;

		const res = await request.get({
			path: `/v1/tournaments/${t.tournamentId}/matches/${target.match_id}`,
			as: t.admin,
		});
		const body = await expectOk<{
			match_id: string;
			tournament_id: string;
			round_id: string;
			round_number: number;
			phase: string;
			division: string | null;
			slot_a_id: string;
			slot_b_id: string | null;
			status: string;
			winner_slot_id: string | null;
			game_id: string | null;
		}>(res);

		expect(body.match_id).toBe(target.match_id);
		expect(body.tournament_id).toBe(t.tournamentId);
		expect(body.phase).toBe("swiss");
		expect(body.round_number).toBe(1);
		expect(body.slot_a_id).toBe(target.slot_a_id);
		expect(body.status).toBe("pending");
	});

	it("resolves completed-match display names from the snapshot occupant's current profile", async () => {
		// The migration-0024 snapshot pins WHO played (user_id); the label is
		// that user's *current* display_name — presentation follows the
		// profile, identity survives substitution. Unclaimed occupants keep
		// the report-time stored-name snapshot.
		const alice = await makeUser({ displayName: "Alice Original" });
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
			slotOwners: { A: [alice] },
		});
		const aliceSlot = t.slotsByDivision.A.find(
			(s) => s.owner?.userId === alice.userId,
		)!;
		const m = (await t.matches()).find(
			(row) =>
				row.slot_a_id === aliceSlot.slotId ||
				row.slot_b_id === aliceSlot.slotId,
		)!;
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}`,
				as: t.admin,
				body: { winner_slot_id: m.slot_a_id, status: "complete" },
			}),
		);

		const aliceSide: "a" | "b" = m.slot_a_id === aliceSlot.slotId ? "a" : "b";
		const fetchNames = async () => {
			const res = await request.get({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}`,
				as: t.admin,
			});
			const body = await expectOk<{
				slot_a_display_name: string | null;
				slot_b_display_name: string | null;
			}>(res);
			return {
				alice:
					aliceSide === "a"
						? body.slot_a_display_name
						: body.slot_b_display_name,
				opponent:
					aliceSide === "a"
						? body.slot_b_display_name
						: body.slot_a_display_name,
			};
		};

		// Claimed occupant → current users.display_name; the unclaimed
		// opponent → its stored-name snapshot.
		const opponentSlotId = aliceSide === "a" ? m.slot_b_id : m.slot_a_id;
		const opponentSlot = [...t.slotsByDivision.A, ...t.slotsByDivision.B].find(
			(s) => s.slotId === opponentSlotId,
		)!;
		let names = await fetchNames();
		expect(names.alice).toBe("Alice Original");
		expect(names.opponent).toBe(opponentSlot.discordUsername);

		// A profile rename shows up on the historical match…
		await env.SHARE_DB.prepare(
			`UPDATE users SET display_name = 'Alice Renamed' WHERE user_id = ?`,
		)
			.bind(alice.userId)
			.run();
		names = await fetchNames();
		expect(names.alice).toBe("Alice Renamed");

		// …but substituting the slot's occupant does NOT rewrite the completed
		// match — the snapshot user keeps the label.
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/slots/${aliceSlot.slotId}`,
				as: t.admin,
				body: { discord_username: "substitute-player" },
			}),
		);
		names = await fetchNames();
		expect(names.alice).toBe("Alice Renamed");
	});

	it("GET /v1/games/:id/tournament-link returns the linked tournament+match for a linked game", async () => {
		// Direct INSERT keeps this test independent of the upload fixture.
		// The handler joins through tournament_matches.game_id, so all we
		// need is a games row + a tournament_matches.game_id pointer.
		const t = await makeTournament({
			name: "Link Cup",
			advanceTo: "swiss-round-1-generated",
		});
		const target = (await t.matches()).find((m) => m.status === "pending")!;

		// Seed a minimal games row owned by the admin. The FK on
		// tournament_matches.game_id requires the row to exist.
		const gameId = nanoid(21);
		await env.SHARE_DB.prepare(
			`INSERT INTO games (game_id, user_id, xml_game_id, total_turns,
			                    file_hash, is_public, parser_version)
			 VALUES (?, ?, 'xml-id', 50, 'deadbeef', 1, '2.4.0')`,
		)
			.bind(gameId, t.admin.userId)
			.run();
		await env.SHARE_DB.prepare(
			`UPDATE tournament_matches SET game_id = ?, status = 'complete',
			        winner_slot_id = slot_a_id, reported_by_user_id = ?,
			        reported_at = datetime('now')
			 WHERE match_id = ?`,
		)
			.bind(gameId, t.admin.userId, target.match_id)
			.run();

		const res = await request.get({
			path: `/v1/games/${gameId}/tournament-link`,
			as: t.admin,
		});
		const body = await expectOk<{
			link: {
				tournament: {
					tournament_id: string;
					slug: string;
					name: string;
					status: string;
				};
				match: {
					match_id: string;
					phase: string;
					division: string | null;
					round_number: number;
					map_script: string | null;
					status: string;
					slot_a_id: string;
					slot_b_id: string | null;
					winner_slot_id: string | null;
					slot_a_display_name: string | null;
					slot_b_display_name: string | null;
				};
			} | null;
		}>(res);

		expect(body.link).not.toBeNull();
		expect(body.link?.tournament.tournament_id).toBe(t.tournamentId);
		expect(body.link?.tournament.slug).toBe(t.slug);
		expect(body.link?.tournament.name).toBe("Link Cup");
		expect(body.link?.match.match_id).toBe(target.match_id);
		expect(body.link?.match.phase).toBe("swiss");
		expect(body.link?.match.status).toBe("complete");
		expect(body.link?.match.slot_a_id).toBe(target.slot_a_id);
		expect(body.link?.match.winner_slot_id).toBe(target.slot_a_id);
		// Display labels resolve through the slots→users join; the builder's
		// slots here are unclaimed, so the stored `a1-…` / `b1-…` style names
		// serve as the fallback labels.
		expect(typeof body.link?.match.slot_a_display_name).toBe("string");
	});

	it("GET /v1/games/:id/tournament-link returns { link: null } for an unlinked game", async () => {
		// Game owner can be anyone; the caller just needs to be in the beta
		// to clear the gate. The handler doesn't gate on ownership.
		const owner = await makeUser();
		const viewer = await makeUser();
		const gameId = nanoid(21);
		await env.SHARE_DB.prepare(
			`INSERT INTO games (game_id, user_id, xml_game_id, total_turns,
			                    file_hash, is_public, parser_version)
			 VALUES (?, ?, 'xml-id', 10, 'cafebabe', 1, '2.4.0')`,
		)
			.bind(gameId, owner.userId)
			.run();

		const res = await request.get({
			path: `/v1/games/${gameId}/tournament-link`,
			as: viewer,
		});
		const body = await expectOk<{ link: unknown | null }>(res);
		expect(body.link).toBeNull();
	});
});

// Drives the smallest possible 4v4 swiss to championship — used by the
// bracket-shape case. Mirrors flow.test.ts but local to keep the
// builder API minimal.
async function driveToChampionship(): Promise<TestTournament> {
	const t = await makeTournament({ slotsPerDivision: 4 });
	await expectOk(
		await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: {
				swiss_wins_to_advance: 1,
				swiss_losses_to_eliminate: 1,
				swiss_max_rounds: 1,
			},
		}),
	);
	await expectOk(
		await request.post({
			path: `/v1/tournaments/${t.tournamentId}/start`,
			as: t.admin,
		}),
	);
	for (const m of await t.matches()) {
		if (m.status === "bye") continue;
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}`,
				as: t.admin,
				body: { winner_slot_id: m.slot_a_id, status: "complete" },
			}),
		);
	}
	await expectOk(
		await request.post({
			path: `/v1/tournaments/${t.tournamentId}/transition-championship`,
			as: t.admin,
		}),
	);
	return t;
}
