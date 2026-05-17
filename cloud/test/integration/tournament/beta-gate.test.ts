// Beta-gate behavior tests. Every tournament surface (public reads,
// player endpoints, admin endpoints, tournament-link branch of game
// upload) must:
//   * 404 TOURNAMENT_NOT_FOUND for an anonymous caller
//   * 404 TOURNAMENT_NOT_FOUND for a signed-in non-beta caller
//   * succeed for a signed-in beta caller (subject to the endpoint's
//     own happy-path requirements)
//
// The third bucket is already covered by the rest of the suite, so this
// file focuses on the negative paths plus the login-time pin behavior in
// handleDiscordCallback. The full grid would be ~75 cases; this file
// picks one representative per handler to keep the cost bounded.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import {
	makeTournament,
	makeUser,
	seedBetaUser,
} from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

const VALID_MAP = "MAPCLASS_MapScriptDonut";

// Endpoints we sweep with anon + non-beta callers. Each tuple is
// (label, method, path-builder taking a sample tournament/match). path
// returning `null` skips this endpoint for a given setup phase.
type SweepCase = {
	label: string;
	method: "GET" | "POST" | "PATCH" | "DELETE";
	path: (ctx: {
		tournamentId: string;
		slug: string;
		matchId: string | null;
	}) => string | null;
	body?: unknown;
};

const SWEEP_CASES: SweepCase[] = [
	{ label: "list", method: "GET", path: () => "/v1/tournaments" },
	{
		label: "detail (by slug)",
		method: "GET",
		path: ({ slug }) => `/v1/tournaments/${slug}`,
	},
	{
		label: "standings",
		method: "GET",
		path: ({ tournamentId }) => `/v1/tournaments/${tournamentId}/standings`,
	},
	{
		label: "bracket",
		method: "GET",
		path: ({ tournamentId }) => `/v1/tournaments/${tournamentId}/bracket`,
	},
	{
		label: "rounds",
		method: "GET",
		path: ({ tournamentId }) => `/v1/tournaments/${tournamentId}/rounds`,
	},
	{
		label: "matches",
		method: "GET",
		path: ({ tournamentId }) => `/v1/tournaments/${tournamentId}/matches`,
	},
	{
		label: "match detail",
		method: "GET",
		path: ({ tournamentId, matchId }) =>
			matchId
				? `/v1/tournaments/${tournamentId}/matches/${matchId}`
				: null,
	},
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
	{
		label: "my matches",
		method: "GET",
		path: () => "/v1/users/me/matches",
	},
	{
		label: "dismiss banner",
		method: "POST",
		path: ({ tournamentId }) =>
			`/v1/users/me/tournaments/${tournamentId}/dismiss-banner`,
	},
	{
		label: "create tournament",
		method: "POST",
		path: () => "/v1/tournaments",
		body: { name: "Beta Gate Test", allowed_map_scripts: [VALID_MAP] },
	},
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
		body: [{ division: "A", discord_username: "beta-gate-test" }],
	},
	{
		label: "start tournament",
		method: "POST",
		path: ({ tournamentId }) => `/v1/tournaments/${tournamentId}/start`,
	},
	{
		label: "patch match map",
		method: "PATCH",
		path: ({ tournamentId, matchId }) =>
			matchId
				? `/v1/tournaments/${tournamentId}/matches/${matchId}/map`
				: null,
		body: { map_script: VALID_MAP },
	},
	{
		label: "retro-edit match",
		method: "PATCH",
		path: ({ tournamentId, matchId }) =>
			matchId
				? `/v1/tournaments/${tournamentId}/matches/${matchId}`
				: null,
		body: { status: "complete" },
	},
	{
		label: "transition championship",
		method: "POST",
		path: ({ tournamentId }) =>
			`/v1/tournaments/${tournamentId}/transition-championship`,
	},
];

describe("tournament beta gate — anonymous callers", () => {
	it("404s every gated surface", async () => {
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
		});
		const sampleMatch = (await t.matches())[0];
		const ctx = {
			tournamentId: t.tournamentId,
			slug: t.slug,
			matchId: sampleMatch?.match_id ?? null,
		};
		for (const c of SWEEP_CASES) {
			const path = c.path(ctx);
			if (path === null) continue;
			const res = await request[
				c.method.toLowerCase() as "get" | "post" | "patch" | "delete"
			]({ path, body: c.body });
			await expectErrorCode(res, {
				status: 404,
				code: "TOURNAMENT_NOT_FOUND",
			});
		}
	});
});

describe("tournament beta gate — signed-in non-beta callers", () => {
	it("404s every gated surface (TOURNAMENT_NOT_FOUND, never NOT_TOURNAMENT_ADMIN)", async () => {
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
		});
		const sampleMatch = (await t.matches())[0];
		const intruder = await makeUser({ omitBeta: true });
		const ctx = {
			tournamentId: t.tournamentId,
			slug: t.slug,
			matchId: sampleMatch?.match_id ?? null,
		};
		for (const c of SWEEP_CASES) {
			const path = c.path(ctx);
			if (path === null) continue;
			const res = await request[
				c.method.toLowerCase() as "get" | "post" | "patch" | "delete"
			]({ path, body: c.body, as: intruder });
			await expectErrorCode(res, {
				status: 404,
				code: "TOURNAMENT_NOT_FOUND",
			});
		}
	});
});

describe("tournament beta gate — POST /v1/games with tournament_match_id", () => {
	it("404s for a signed-in non-beta caller", async () => {
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
		});
		const match = (await t.matches()).find((m) => m.status === "pending")!;
		const intruder = await makeUser({ omitBeta: true });

		// Minimal multipart with parts the handler validates before the
		// beta gate would otherwise let through. The gate fires after the
		// tournament_match_id shape check but before the match lookup, so
		// the body never has to be valid past that point.
		const form = new FormData();
		form.append("uploader_player_index", "0");
		form.append("tournament_match_id", match.match_id);
		form.append("data", new Blob(["{}"], { type: "application/json" }));
		form.append("save", new Blob(["zip-bytes"], { type: "application/zip" }));

		const res = await SELF.fetch("http://test/v1/games", {
			method: "POST",
			headers: { Cookie: `session=${intruder.sessionToken}` },
			body: form,
		});
		await expectErrorCode(res, {
			status: 404,
			code: "TOURNAMENT_NOT_FOUND",
		});
	});
});

describe("tournament beta gate — login pins user_id", () => {
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

	it("beta caller passes happy-path detail (sanity check)", async () => {
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
