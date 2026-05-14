// Behavior tests for round generation and the deterministic-ordering work.
//
// Covers:
//   #3   match_index column is populated at every INSERT site (swiss,
//        championship round 1, championship follow-up). loadMatches /
//        loadMatchesWithRound order by match_index. Same DB state produces
//        the same pairings across reads.
//   regression: pending-prior-round block.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

describe("match_index population (#3)", () => {
	it("populates match_index 1..N when generating a swiss round", async () => {
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
		});

		const matches = await t.matches();
		expect(matches.length).toBeGreaterThan(0);
		// Group by round_id and verify each round has match_index 1..N.
		const byRound = new Map<string, number[]>();
		for (const m of matches) {
			const list = byRound.get(m.round_id) ?? [];
			expect(m.match_index).not.toBeNull();
			list.push(m.match_index!);
			byRound.set(m.round_id, list);
		}
		for (const [, indexes] of byRound) {
			indexes.sort((a, b) => a - b);
			expect(indexes).toEqual(
				Array.from({ length: indexes.length }, (_, i) => i + 1),
			);
		}
	});

	it("populates match_index 1..N when generating championship round 1", async () => {
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
				path: `/v1/tournaments/${t.tournamentId}/start-swiss`,
				as: t.admin,
			}),
		);
		for (const division of ["A", "B"] as const) {
			const r = await request.post({
				path: `/v1/tournaments/${t.tournamentId}/rounds`,
				as: t.admin,
				body: { division },
			});
			const { round_id } = await expectOk<{ round_id: string }>(r);
			await expectOk(
				await request.post({
					path: `/v1/tournaments/${t.tournamentId}/rounds/${round_id}/start`,
					as: t.admin,
				}),
			);
		}
		for (const m of await t.matches()) {
			if (m.status === "bye") continue;
			await expectOk(
				await request.patch({
					path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}`,
					as: t.admin,
					body: { winner_slot_id: m.slot_a_id, status: "reported" },
				}),
			);
		}
		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/transition-championship`,
				as: t.admin,
			}),
		);

		const champRounds = (await t.rounds()).filter(
			(r) => r.phase === "championship",
		);
		expect(champRounds).toHaveLength(1);
		const champMatches = (await t.matches()).filter(
			(m) => m.round_id === champRounds[0].round_id,
		);
		expect(champMatches.length).toBeGreaterThan(0);
		const indexes = champMatches.map((m) => m.match_index).sort();
		expect(indexes).toEqual(
			Array.from({ length: indexes.length }, (_, i) => i + 1),
		);
	});

	it("populates match_index 1..N on a championship follow-up round", async () => {
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
				path: `/v1/tournaments/${t.tournamentId}/start-swiss`,
				as: t.admin,
			}),
		);
		for (const division of ["A", "B"] as const) {
			const r = await request.post({
				path: `/v1/tournaments/${t.tournamentId}/rounds`,
				as: t.admin,
				body: { division },
			});
			const { round_id } = await expectOk<{ round_id: string }>(r);
			await expectOk(
				await request.post({
					path: `/v1/tournaments/${t.tournamentId}/rounds/${round_id}/start`,
					as: t.admin,
				}),
			);
		}
		for (const m of await t.matches()) {
			if (m.status === "bye") continue;
			await expectOk(
				await request.patch({
					path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}`,
					as: t.admin,
					body: { winner_slot_id: m.slot_a_id, status: "reported" },
				}),
			);
		}
		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/transition-championship`,
				as: t.admin,
			}),
		);
		// Start + report championship R1 (semis), then generate R2 (final).
		const champR1 = (await t.rounds()).find(
			(r) => r.phase === "championship" && r.round_number === 1,
		)!;
		await expectOk(
			await request.post({
				path: `/v1/tournaments/${t.tournamentId}/rounds/${champR1.round_id}/start`,
				as: t.admin,
			}),
		);
		for (const m of await t.matches()) {
			if (m.round_id !== champR1.round_id) continue;
			await expectOk(
				await request.patch({
					path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}`,
					as: t.admin,
					body: { winner_slot_id: m.slot_a_id, status: "reported" },
				}),
			);
		}
		const r2Res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/rounds`,
			as: t.admin,
		});
		const { round_id: r2Id } = await expectOk<{ round_id: string }>(r2Res);

		const r2Matches = (await t.matches()).filter((m) => m.round_id === r2Id);
		expect(r2Matches.length).toBeGreaterThan(0);
		for (const m of r2Matches) {
			expect(m.match_index).not.toBeNull();
		}
		const indexes = r2Matches.map((m) => m.match_index).sort();
		expect(indexes).toEqual(
			Array.from({ length: indexes.length }, (_, i) => i + 1),
		);
	});
});

describe("ordering via public read paths (#3)", () => {
	it("GET /v1/tournaments/:id/matches returns matches in match_index order within each round", async () => {
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
		});

		const res = await request.get({
			path: `/v1/tournaments/${t.tournamentId}/matches`,
			as: t.admin,
		});
		const body = await expectOk<{
			matches: Array<{
				match_id: string;
				round_id: string;
				match_index: number | null;
			}>;
		}>(res);

		const byRound = new Map<
			string,
			Array<{ match_index: number | null }>
		>();
		for (const m of body.matches) {
			const list = byRound.get(m.round_id) ?? [];
			list.push(m);
			byRound.set(m.round_id, list);
		}
		for (const [, list] of byRound) {
			const indexes = list.map((m) => m.match_index);
			expect(indexes).toEqual([...indexes].sort());
		}
	});

	it("produces identical match ordering across two reads of the same DB state", async () => {
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
		});

		const [first, second] = await Promise.all([
			request.get({
				path: `/v1/tournaments/${t.tournamentId}/matches`,
				as: t.admin,
			}),
			request.get({
				path: `/v1/tournaments/${t.tournamentId}/matches`,
				as: t.admin,
			}),
		]);
		const a = await expectOk<{ matches: Array<{ match_id: string }> }>(first);
		const b = await expectOk<{ matches: Array<{ match_id: string }> }>(second);

		expect(a.matches.map((m) => m.match_id)).toEqual(
			b.matches.map((m) => m.match_id),
		);
	});
});

describe("round-generation guards (regression)", () => {
	it("rejects generating a swiss round while the prior round has pending matches", async () => {
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
		});

		// Try to generate round 2 for division A without reporting round 1.
		const res = await request.post({
			path: `/v1/tournaments/${t.tournamentId}/rounds`,
			as: t.admin,
			body: { division: "A" },
		});

		// Handler uses one of a few possible codes (PRIOR_ROUND_*) — just assert 409.
		expect(res.status).toBe(409);
	});
});
