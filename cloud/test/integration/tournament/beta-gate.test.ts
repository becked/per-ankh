// Tournament access tiers. The private-beta gate has been lifted; the model
// is now:
//   * Reads (list / detail / standings / bracket / rounds / matches /
//     match-detail) are public — 200 for anonymous and non-allowlisted
//     callers alike.
//   * Participation + "my" endpoints require a session — 401 when anonymous.
//   * Admin endpoints require tournament admin — 401 anon, 403
//     NOT_TOURNAMENT_ADMIN for a signed-in non-admin.
//   * Create is the one surviving allowlist gate — 401 anon, 403
//     TOURNAMENT_CREATE_FORBIDDEN for a signed-in non-allowlisted caller.
//
// The login-time pin on tournament_beta_users (still used by create and
// /v1/auth/me) is covered at the bottom.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser, seedBetaUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

const VALID_MAP = "MAPCLASS_MapScriptDonut";

type Ctx = { tournamentId: string; slug: string; matchId: string | null };

// ---------------------------------------------------------------------------
// Reads — public
// ---------------------------------------------------------------------------

const READ_CASES: { label: string; path: (c: Ctx) => string | null }[] = [
	{ label: "list", path: () => "/v1/tournaments" },
	{ label: "detail (by slug)", path: ({ slug }) => `/v1/tournaments/${slug}` },
	{
		label: "standings",
		path: ({ tournamentId }) => `/v1/tournaments/${tournamentId}/standings`,
	},
	{
		label: "bracket",
		path: ({ tournamentId }) => `/v1/tournaments/${tournamentId}/bracket`,
	},
	{
		label: "rounds",
		path: ({ tournamentId }) => `/v1/tournaments/${tournamentId}/rounds`,
	},
	{
		label: "matches",
		path: ({ tournamentId }) => `/v1/tournaments/${tournamentId}/matches`,
	},
	{
		label: "match detail",
		path: ({ tournamentId, matchId }) =>
			matchId ? `/v1/tournaments/${tournamentId}/matches/${matchId}` : null,
	},
];

describe("tournament reads — public", () => {
	it("200 for anonymous and non-allowlisted callers", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const sampleMatch = (await t.matches())[0];
		const ctx: Ctx = {
			tournamentId: t.tournamentId,
			slug: t.slug,
			matchId: sampleMatch?.match_id ?? null,
		};
		const stranger = await makeUser({ omitBeta: true });
		for (const c of READ_CASES) {
			const path = c.path(ctx);
			if (path === null) continue;
			await expectOk(await request.get({ path }));
			await expectOk(await request.get({ path, as: stranger }));
		}
	});
});

// ---------------------------------------------------------------------------
// Participation + "my" endpoints — require a session
// ---------------------------------------------------------------------------

const SESSION_CASES: {
	label: string;
	method: "GET" | "POST" | "DELETE";
	path: (c: Ctx) => string;
	body?: unknown;
}[] = [
	{
		label: "my tournaments",
		method: "GET",
		path: () => "/v1/users/me/tournaments",
	},
	{
		label: "my admin tournaments",
		method: "GET",
		path: () => "/v1/users/me/admin-tournaments",
	},
	{ label: "my matches", method: "GET", path: () => "/v1/users/me/matches" },
	{
		label: "dismiss banner",
		method: "POST",
		path: ({ tournamentId }) =>
			`/v1/users/me/tournaments/${tournamentId}/dismiss-banner`,
	},
	{
		label: "signup",
		method: "POST",
		path: ({ tournamentId }) => `/v1/tournaments/${tournamentId}/signup`,
		body: { division: "A" },
	},
	{
		label: "withdraw",
		method: "DELETE",
		path: ({ tournamentId }) => `/v1/tournaments/${tournamentId}/signup`,
	},
];

describe("participation + my endpoints — require a session", () => {
	it("401 UNAUTHORIZED for anonymous callers", async () => {
		const t = await makeTournament();
		const ctx: Ctx = {
			tournamentId: t.tournamentId,
			slug: t.slug,
			matchId: null,
		};
		for (const c of SESSION_CASES) {
			const res = await request[
				c.method.toLowerCase() as "get" | "post" | "delete"
			]({ path: c.path(ctx), body: c.body });
			await expectErrorCode(res, { status: 401, code: "UNAUTHORIZED" });
		}
	});

	it("a non-allowlisted signed-in user can read their own lists", async () => {
		const stranger = await makeUser({ omitBeta: true });
		await expectOk(
			await request.get({ path: "/v1/users/me/tournaments", as: stranger }),
		);
		await expectOk(
			await request.get({
				path: "/v1/users/me/admin-tournaments",
				as: stranger,
			}),
		);
		await expectOk(
			await request.get({ path: "/v1/users/me/matches", as: stranger }),
		);
	});
});

// ---------------------------------------------------------------------------
// Admin endpoints — require tournament admin
// ---------------------------------------------------------------------------

const ADMIN_CASES: {
	label: string;
	method: "POST" | "PATCH";
	path: (c: Ctx) => string | null;
	body?: unknown;
}[] = [
	{
		label: "patch tournament",
		method: "PATCH",
		path: ({ tournamentId }) => `/v1/tournaments/${tournamentId}`,
		body: { name: "Renamed" },
	},
	{
		label: "bulk create slots",
		method: "POST",
		path: ({ tournamentId }) => `/v1/tournaments/${tournamentId}/slots`,
		body: [{ division: "A", discord_username: "intruder-test" }],
	},
	{
		label: "start tournament",
		method: "POST",
		path: ({ tournamentId }) => `/v1/tournaments/${tournamentId}/start`,
	},
	{
		label: "transition championship",
		method: "POST",
		path: ({ tournamentId }) =>
			`/v1/tournaments/${tournamentId}/transition-championship`,
	},
	{
		label: "patch match map",
		method: "PATCH",
		path: ({ tournamentId, matchId }) =>
			matchId ? `/v1/tournaments/${tournamentId}/matches/${matchId}/map` : null,
		body: { map_pool_id: "map-0" },
	},
	{
		label: "retro-edit match",
		method: "PATCH",
		path: ({ tournamentId, matchId }) =>
			matchId ? `/v1/tournaments/${tournamentId}/matches/${matchId}` : null,
		body: { status: "complete" },
	},
];

describe("admin endpoints — require tournament admin", () => {
	it("401 anon, 403 NOT_TOURNAMENT_ADMIN for a signed-in non-admin", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		const sampleMatch = (await t.matches())[0];
		const ctx: Ctx = {
			tournamentId: t.tournamentId,
			slug: t.slug,
			matchId: sampleMatch?.match_id ?? null,
		};
		const stranger = await makeUser({ omitBeta: true });
		for (const c of ADMIN_CASES) {
			const path = c.path(ctx);
			if (path === null) continue;
			const method = c.method.toLowerCase() as "post" | "patch";
			await expectErrorCode(await request[method]({ path, body: c.body }), {
				status: 401,
				code: "UNAUTHORIZED",
			});
			await expectErrorCode(
				await request[method]({ path, body: c.body, as: stranger }),
				{ status: 403, code: "NOT_TOURNAMENT_ADMIN" },
			);
		}
	});
});

// ---------------------------------------------------------------------------
// Create — the one surviving allowlist gate
// ---------------------------------------------------------------------------

describe("create — allowlist only", () => {
	const body = { name: "Allowlist Test", map_pool: [{ script: VALID_MAP }] };

	it("401 for an anonymous caller", async () => {
		await expectErrorCode(
			await request.post({ path: "/v1/tournaments", body }),
			{ status: 401, code: "UNAUTHORIZED" },
		);
	});

	it("403 TOURNAMENT_CREATE_FORBIDDEN for a signed-in non-allowlisted caller", async () => {
		const stranger = await makeUser({ omitBeta: true });
		await expectErrorCode(
			await request.post({ path: "/v1/tournaments", body, as: stranger }),
			{ status: 403, code: "TOURNAMENT_CREATE_FORBIDDEN" },
		);
	});

	it("succeeds for an allowlisted caller", async () => {
		const organizer = await makeUser(); // beta-seeded by default
		await expectOk(
			await request.post({ path: "/v1/tournaments", body, as: organizer }),
		);
	});
});

// ---------------------------------------------------------------------------
// Match reporting via upload — participant/admin only (no beta gate)
// ---------------------------------------------------------------------------

describe("POST /v1/games with tournament_match_id", () => {
	it("403 NOT_MATCH_PARTICIPANT for a signed-in non-participant", async () => {
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
		});
		const match = (await t.matches()).find((m) => m.status === "pending")!;
		const stranger = await makeUser({ omitBeta: true });

		// Minimal multipart with the parts the handler validates before the
		// participant check. That check fires after the match lookup but
		// before any blob parsing, so the body never has to be valid past it.
		const form = new FormData();
		form.append("uploader_player_index", "0");
		form.append("tournament_match_id", match.match_id);
		form.append("data", new Blob(["{}"], { type: "application/json" }));
		form.append("save", new Blob(["zip-bytes"], { type: "application/zip" }));

		const res = await SELF.fetch("http://test/v1/games", {
			method: "POST",
			headers: { Cookie: `session=${stranger.sessionToken}` },
			body: form,
		});
		await expectErrorCode(res, {
			status: 403,
			code: "NOT_MATCH_PARTICIPANT",
		});
	});
});

// ---------------------------------------------------------------------------
// Login-time beta pin (tournament_beta_users still backs create + auth/me)
// ---------------------------------------------------------------------------

describe("tournament allowlist — login pins user_id", () => {
	it("seeding by discord_id pre-login fills in user_id on signup", async () => {
		// Pre-grant by raw discord_id (no user_id) — simulates the CLI
		// `beta-grant <discord-id>` path for a user who hasn't signed up yet.
		const preDiscordId = "999000111222333444";
		await env.SHARE_DB.prepare(
			`INSERT INTO tournament_beta_users (discord_id) VALUES (?)`,
		)
			.bind(preDiscordId)
			.run();

		// Simulate handleDiscordCallback's beta-pin step by inserting the
		// user row and running the same UPDATE the worker runs. (Going
		// through the full OAuth flow would require mocking Discord; the
		// behavior under test is the SQL pin, not the OAuth state machine.)
		const userId = nanoid(21);
		await env.SHARE_DB.prepare(
			`INSERT INTO users (user_id, discord_id, display_name) VALUES (?, ?, 'preg')`,
		)
			.bind(userId, preDiscordId)
			.run();
		await env.SHARE_DB.prepare(
			`UPDATE tournament_beta_users SET user_id = ?
			 WHERE discord_id = ? AND user_id IS NULL`,
		)
			.bind(userId, preDiscordId)
			.run();

		const row = await env.SHARE_DB.prepare(
			`SELECT user_id FROM tournament_beta_users WHERE discord_id = ?`,
		)
			.bind(preDiscordId)
			.first<{ user_id: string }>();
		expect(row?.user_id).toBe(userId);
	});

	it("seedBetaUser is idempotent (second call doesn't raise)", async () => {
		const user = await makeUser({ omitBeta: true });
		await seedBetaUser(user);
		await seedBetaUser(user);
		const count = await env.SHARE_DB.prepare(
			`SELECT COUNT(*) AS n FROM tournament_beta_users WHERE discord_id = ?`,
		)
			.bind(user.discordId)
			.first<{ n: number }>();
		expect(count?.n).toBe(1);
	});

	it("allowlisted caller passes happy-path detail (sanity check)", async () => {
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
		});
		const res = await request.get({
			path: `/v1/tournaments/${t.slug}`,
			as: t.admin,
		});
		await expectOk(res);
	});
});
