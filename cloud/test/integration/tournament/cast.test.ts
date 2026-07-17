// Behavior tests for the caster self-service endpoints:
//   POST   /v1/tournaments/:id/matches/:match_id/parts/:part_id/casters/me
//   DELETE /v1/tournaments/:id/matches/:match_id/parts/:part_id/casters/me
//
// Any logged-in user may add/move/remove THEMSELVES on a scheduled part's
// caster list (index 0 = streamer, the rest co-casters), scoped so they only
// ever touch their own entry — never the whole list like the admin schedule
// endpoint. Casting is pending-only; self-removal also works on decided
// matches. Both respond 204 (no body) — state is asserted from the row.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

const WHEN = "2026-07-05T18:00:00.000Z";

type T = Awaited<ReturnType<typeof makeTournament>>;

async function castersOf(
	t: T,
	matchId: string,
	partId: string,
): Promise<{ user_id: string | null; name: string | null }[]> {
	const m = (await t.matches()).find((row) => row.match_id === matchId);
	const parts = JSON.parse((m?.parts as string) ?? "[]") as {
		id: string;
		casters: { user_id: string | null; name: string | null }[];
	}[];
	return parts.find((p) => p.id === partId)?.casters ?? [];
}

async function streamsOf(
	t: T,
	matchId: string,
	partId: string,
): Promise<{ url: string; label: string | null }[]> {
	const m = (await t.matches()).find((row) => row.match_id === matchId);
	const parts = JSON.parse((m?.parts as string) ?? "[]") as {
		id: string;
		streams: { url: string; label: string | null }[];
	}[];
	return parts.find((p) => p.id === partId)?.streams ?? [];
}

// Create a scheduled part on the first pending match (admin), returning ids.
async function setup() {
	const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
	const m = (await t.matches()).find((row) => row.status === "pending")!;
	const scheduled = await expectOk<{ match: { parts: { id: string }[] } }>(
		await request.patch({
			path: `/v1/tournaments/${t.tournamentId}/matches/${m.match_id}/schedule`,
			as: t.admin,
			body: { parts: [{ scheduled_at: WHEN, casters: [], streams: [] }] },
		}),
	);
	return { t, match: m, partId: scheduled.match.parts[0].id };
}

function castPath(tid: string, mid: string, pid: string) {
	return `/v1/tournaments/${tid}/matches/${mid}/parts/${pid}/casters/me`;
}

describe("caster self-service", () => {
	it("first caster becomes the streamer; second becomes a co-caster", async () => {
		const { t, match, partId } = await setup();
		const alice = await makeUser({ discordUsername: "alice_caster" });
		const bob = await makeUser({ discordUsername: "bob_caster" });

		const r1 = await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: alice,
			body: {},
		});
		expect(r1.status).toBe(204);
		expect(await castersOf(t, match.match_id, partId)).toEqual([
			{ user_id: alice.userId, name: "alice_caster" },
		]);

		const r2 = await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: bob,
			body: {},
		});
		expect(r2.status).toBe(204);
		expect(
			(await castersOf(t, match.match_id, partId)).map((c) => c.user_id),
		).toEqual([
			alice.userId, // streamer stays first
			bob.userId, // appended as co-caster
		]);
	});

	it("a co-caster can promote themselves to streamer, bumping the current one", async () => {
		const { t, match, partId } = await setup();
		const alice = await makeUser({ discordUsername: "alice_caster" });
		const bob = await makeUser({ discordUsername: "bob_caster" });
		await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: alice,
			body: {},
		});
		await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: bob,
			body: {},
		});

		const res = await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: bob,
			body: { role: "streamer" },
		});
		expect(res.status).toBe(204);
		// Bob to the front; alice (former streamer) demoted; no duplicates.
		expect(
			(await castersOf(t, match.match_id, partId)).map((c) => c.user_id),
		).toEqual([bob.userId, alice.userId]);
	});

	it("dropping removes only the caller, leaving others", async () => {
		const { t, match, partId } = await setup();
		const alice = await makeUser({ discordUsername: "alice_caster" });
		const bob = await makeUser({ discordUsername: "bob_caster" });
		await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: alice,
			body: {},
		});
		await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: bob,
			body: {},
		});

		const res = await request.delete({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: bob,
		});
		expect(res.status).toBe(204);
		expect(
			(await castersOf(t, match.match_id, partId)).map((c) => c.user_id),
		).toEqual([alice.userId]);
	});

	it("returns 401 to an anonymous caller", async () => {
		const { t, match, partId } = await setup();
		await expectErrorCode(
			await request.post({
				path: castPath(t.tournamentId, match.match_id, partId),
				body: {},
			}),
			{ status: 401, code: "UNAUTHORIZED" },
		);
	});

	it("returns 404 for an unknown part", async () => {
		const { t, match } = await setup();
		const alice = await makeUser();
		await expectErrorCode(
			await request.post({
				path: castPath(t.tournamentId, match.match_id, "nope"),
				as: alice,
				body: {},
			}),
			{ status: 404, code: "PART_NOT_FOUND" },
		);
	});

	it("rejects CASTING a decided match but allows self-REMOVAL", async () => {
		const { t, match, partId } = await setup();
		const alice = await makeUser({ discordUsername: "alice_caster" });
		await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: alice,
			body: {},
		});
		// Decide the match (admin retro-edit).
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${match.match_id}`,
				as: t.admin,
				body: { winner_slot_id: match.slot_a_id, status: "complete" },
			}),
		);
		// New casting is closed…
		await expectErrorCode(
			await request.post({
				path: castPath(t.tournamentId, match.match_id, partId),
				as: alice,
				body: {},
			}),
			{ status: 409, code: "MATCH_NOT_PENDING" },
		);
		// …but removing YOURSELF still works — a caster who signed up and never
		// actually cast shouldn't stay credited on the archive.
		const res = await request.delete({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: alice,
		});
		expect(res.status).toBe(204);
		expect(await castersOf(t, match.match_id, partId)).toEqual([]);
	});
});

// The streamer's stream link (users.stream_url) is auto-attached to the part
// when they take index 0 — remembered from account settings or from a
// stream_url sent with the cast itself — and removed again when they drop.
describe("caster stream auto-attach", () => {
	const TWITCH = "https://twitch.tv/alice_caster";

	it("remembers a stream_url sent with the cast and auto-attaches it on later casts", async () => {
		const { t, match, partId } = await setup();
		const alice = await makeUser({ discordUsername: "alice_caster" });

		// First cast provides the link once: attached AND persisted.
		const r1 = await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: alice,
			body: { stream_url: TWITCH },
		});
		expect(r1.status).toBe(204);
		expect(await streamsOf(t, match.match_id, partId)).toEqual([
			{ url: TWITCH, label: null },
		]);
		const me = await expectOk<{ stream_url: string | null }>(
			await request.get({ path: "/v1/auth/me", as: alice }),
		);
		expect(me.stream_url).toBe(TWITCH);

		// A later cast on a fresh part needs only the click.
		const { t: t2, match: m2, partId: p2 } = await setup();
		const r2 = await request.post({
			path: castPath(t2.tournamentId, m2.match_id, p2),
			as: alice,
			body: {},
		});
		expect(r2.status).toBe(204);
		expect(await streamsOf(t2, m2.match_id, p2)).toEqual([
			{ url: TWITCH, label: null },
		]);
	});

	it("a link saved via account settings attaches for the streamer but not a co-caster", async () => {
		const { t, match, partId } = await setup();
		const alice = await makeUser({ discordUsername: "alice_caster" });
		const bob = await makeUser({ discordUsername: "bob_caster" });
		const bobUrl = "https://twitch.tv/bob_caster";
		await expectOk(
			await request.post({
				path: "/v1/auth/settings",
				as: bob,
				body: { stream_url: bobUrl },
			}),
		);

		// Alice (no stored link) takes the streamer slot: no stream appears.
		await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: alice,
			body: {},
		});
		expect(await streamsOf(t, match.match_id, partId)).toEqual([]);

		// Bob joins as co-caster: his link stays off the part (the cast airs on
		// the streamer's channel)…
		await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: bob,
			body: {},
		});
		expect(await streamsOf(t, match.match_id, partId)).toEqual([]);

		// …until he promotes himself to streamer.
		await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: bob,
			body: { role: "streamer" },
		});
		expect(await streamsOf(t, match.match_id, partId)).toEqual([
			{ url: bobUrl, label: null },
		]);
	});

	it("never duplicates an already-listed URL", async () => {
		const { t, match, partId } = await setup();
		const alice = await makeUser({ discordUsername: "alice_caster" });
		await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: alice,
			body: { stream_url: TWITCH },
		});
		// Re-cast as streamer with the same stored link.
		await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: alice,
			body: { role: "streamer" },
		});
		expect(await streamsOf(t, match.match_id, partId)).toEqual([
			{ url: TWITCH, label: null },
		]);
	});

	it("dropping removes the caller's stream link but leaves others' streams", async () => {
		const { t, match, partId } = await setup();
		const alice = await makeUser({ discordUsername: "alice_caster" });
		await request.post({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: alice,
			body: { stream_url: TWITCH },
		});
		// An admin-added unrelated stream must survive alice's drop. (Replace-all
		// echoes the current parts list plus the extra stream.)
		const other = { url: "https://youtube.com/watch?v=other", label: "VOD" };
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}/matches/${match.match_id}/schedule`,
				as: t.admin,
				body: {
					parts: [
						{
							id: partId,
							scheduled_at: WHEN,
							casters: await castersOf(t, match.match_id, partId),
							streams: [{ url: TWITCH, label: null }, other],
						},
					],
				},
			}),
		);

		const res = await request.delete({
			path: castPath(t.tournamentId, match.match_id, partId),
			as: alice,
		});
		expect(res.status).toBe(204);
		expect(await castersOf(t, match.match_id, partId)).toEqual([]);
		expect(await streamsOf(t, match.match_id, partId)).toEqual([other]);
	});

	it("rejects a stream_url outside the twitch/youtube allowlist", async () => {
		const { t, match, partId } = await setup();
		const alice = await makeUser({ discordUsername: "alice_caster" });
		await expectErrorCode(
			await request.post({
				path: castPath(t.tournamentId, match.match_id, partId),
				as: alice,
				body: { stream_url: "https://example.com/live" },
			}),
			{ status: 400, code: "INVALID_BODY" },
		);
		// Same allowlist on the settings path.
		await expectErrorCode(
			await request.post({
				path: "/v1/auth/settings",
				as: alice,
				body: { stream_url: "https://example.com/live" },
			}),
			{ status: 400, code: "INVALID_BODY" },
		);
	});

	it("settings can set and clear the stream link", async () => {
		const alice = await makeUser({ discordUsername: "alice_caster" });
		const set = await expectOk<{ stream_url: string | null }>(
			await request.post({
				path: "/v1/auth/settings",
				as: alice,
				body: { stream_url: TWITCH },
			}),
		);
		expect(set.stream_url).toBe(TWITCH);

		const cleared = await expectOk<{
			stream_url: string | null;
			default_game_public: boolean;
		}>(
			await request.post({
				path: "/v1/auth/settings",
				as: alice,
				body: { stream_url: null },
			}),
		);
		expect(cleared.stream_url).toBeNull();
		// The partial write didn't clobber the untouched preference.
		expect(cleared.default_game_public).toBe(true);
	});
});
