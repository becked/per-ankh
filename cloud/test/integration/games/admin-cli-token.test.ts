// Integration tests for the headless admin credential — ADMIN_CLI_TOKEN on
// POST /v1/admin/games/:user_id/reparse-upload (siteAdminFromCliToken in
// cloud/src/admin.ts).
//
// This is the one admin endpoint reachable without a session, so the tests
// that matter are about the edges of that sentence: the token works with no
// cookie and no Origin (the shape `./per-ankh admin reparse-all` sends), a
// wrong token is indistinguishable from no credential, and the token does NOT
// open any other /v1/admin/* endpoint. The audit assertions pin the
// `acting_via` discriminator on both branches — a token sweep and a browser
// sweep write the same `acting_user_id`, so that field is the only thing in
// the row that tells them apart.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectOk, expectStatus } from "../../helpers/assertions";
import { makeSiteAdmin, makeUser, type TestUser } from "../../helpers/builders";
import { ADMIN_CLI_TEST_TOKEN } from "../../helpers/admin-identity";
import { postMultipart, request } from "../../helpers/requests";
import { buildUploadFormData } from "../../helpers/save-blob";

// One site admin for the file: users.discord_id is UNIQUE and makeSiteAdmin
// always claims SITE_ADMIN_DISCORD_ID, so a second call in the same isolate
// fails the constraint. Every test here needs the same admin anyway — the
// token path resolves it from ADMIN_DISCORD_ID rather than being told who it
// is, so "which admin" is never the variable.
let admin: TestUser;

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	admin = await makeSiteAdmin({ discordUsername: "cli-token-admin" });
});

interface UploadResponse {
	game_id: string;
	reimported?: boolean;
	from_version?: string;
	to_version?: string;
}

// The newest admin_reimport row's metadata for a game, parsed.
async function auditMetadata(
	gameId: string,
): Promise<Record<string, unknown> | null> {
	const row = await env.SHARE_DB.prepare(
		`SELECT metadata FROM events
		 WHERE event_type = 'admin_reimport' AND game_id = ?
		 ORDER BY id DESC LIMIT 1`,
	)
		.bind(gameId)
		.first<{ metadata: string }>();
	return row ? (JSON.parse(row.metadata) as Record<string, unknown>) : null;
}

describe("POST /v1/admin/games/:user_id/reparse-upload — CLI token", () => {
	it("accepts the token with no session and no Origin, and reimports", async () => {
		const owner = await makeUser({ discordUsername: "cli-token-owner" });
		// One save, uploaded twice: the second pass is the sweep's actual shape
		// — the same ZIP bytes (so the (user_id, file_hash) dedup hits) carrying
		// a newer parser_version, which is what handleGameUpload reads as a
		// re-import rather than a duplicate.
		const nonce = "cli-token-reimport";

		const first = await postMultipart({
			path: `/v1/admin/games/${owner.userId}/reparse-upload`,
			form: await buildUploadFormData({
				winnerIndex: 0,
				nonce,
				parserVersion: "2.4.0",
			}),
			bearer: ADMIN_CLI_TEST_TOKEN,
			noOrigin: true,
		});
		await expectStatus(first, 201);
		const created = await expectOk<UploadResponse>(first);

		const second = await postMultipart({
			path: `/v1/admin/games/${owner.userId}/reparse-upload`,
			form: await buildUploadFormData({
				winnerIndex: 0,
				nonce,
				parserVersion: "2.5.0",
			}),
			bearer: ADMIN_CLI_TEST_TOKEN,
			noOrigin: true,
		});
		await expectStatus(second, 200);
		const reimported = await expectOk<UploadResponse>(second);
		expect(reimported.reimported).toBe(true);
		expect(reimported.game_id).toBe(created.game_id);
		expect(reimported.from_version).toBe("2.4.0");
		expect(reimported.to_version).toBe("2.5.0");

		// The game belongs to the target user, not the admin.
		const game = await env.SHARE_DB.prepare(
			"SELECT user_id, parser_version FROM games WHERE game_id = ?",
		)
			.bind(created.game_id)
			.first<{ user_id: string; parser_version: string }>();
		expect(game?.user_id).toBe(owner.userId);
		expect(game?.parser_version).toBe("2.5.0");

		// Audited as the admin, via the CLI.
		const metadata = await auditMetadata(created.game_id);
		expect(metadata?.acting_user_id).toBe(admin.userId);
		expect(metadata?.acting_via).toBe("cli");
	});

	it("records acting_via=session when a logged-in admin posts the same thing", async () => {
		const owner = await makeUser({ discordUsername: "cli-token-owner-2" });

		const res = await postMultipart({
			path: `/v1/admin/games/${owner.userId}/reparse-upload`,
			form: await buildUploadFormData({ winnerIndex: 0 }),
			as: admin,
		});
		await expectStatus(res, 201);
		const body = await expectOk<UploadResponse>(res);

		const metadata = await auditMetadata(body.game_id);
		expect(metadata?.acting_user_id).toBe(admin.userId);
		expect(metadata?.acting_via).toBe("session");
	});

	it("404s on a wrong token, a bare scheme, and no credential at all", async () => {
		const owner = await makeUser({ discordUsername: "cli-token-owner-3" });
		const path = `/v1/admin/games/${owner.userId}/reparse-upload`;

		// A bare `Bearer ` is the empty-presented case: the gate has to refuse
		// it even with the secret set, which is what keeps a blank secret from
		// admitting everyone.
		for (const bearer of ["not-the-token", "", undefined]) {
			const res = await postMultipart({
				path,
				form: await buildUploadFormData({ winnerIndex: 0 }),
				noOrigin: true,
				bearer,
			});
			expect(res.status, `bearer ${JSON.stringify(bearer)}`).toBe(404);
		}

		// Nothing was written for any of them.
		const row = await env.SHARE_DB.prepare(
			"SELECT COUNT(*) AS n FROM games WHERE user_id = ?",
		)
			.bind(owner.userId)
			.first<{ n: number }>();
		expect(row?.n).toBe(0);
	});

	it("does not open any other admin endpoint", async () => {
		// The sweep reads D1 and R2 through wrangler, so these stay
		// session-only — the token is scoped to the one write the CLI cannot do
		// for itself. A 404 here is what keeps it from being a standing
		// credential for the whole admin surface.
		for (const path of [
			"/v1/admin/games/all",
			"/v1/admin/games/out-of-date?version=2.25.0",
			"/v1/admin/screenshots",
			"/v1/admin/featured-videos",
		]) {
			const res = await request.get({ path, bearer: ADMIN_CLI_TEST_TOKEN });
			expect(res.status, `${path} accepted the CLI token`).toBe(404);
		}
	});
});
