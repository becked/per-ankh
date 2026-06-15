// Behavior tests for PATCH /v1/tournaments/:id with links.
//
// Covers: setting + reading back the list, the http(s)-only scheme guard, the
// count cap, admin-only writes, and that links (unlike map_pool/Swiss config)
// stay editable after the tournament leaves setup.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, makeUser, type TestUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

interface Link {
	label: string;
	url: string;
}
interface DetailResponse {
	links: Link[];
}

async function getDetail(slug: string, as: TestUser): Promise<DetailResponse> {
	const res = await request.get({ path: `/v1/tournaments/${slug}`, as });
	return await expectOk<DetailResponse>(res);
}

describe("PATCH /v1/tournaments/:id — links", () => {
	it("defaults to an empty list", async () => {
		const t = await makeTournament();
		const detail = await getDetail(t.slug, t.admin);
		expect(detail.links).toEqual([]);
	});

	it("sets and returns links in order", async () => {
		const t = await makeTournament();
		const links: Link[] = [
			{ label: "Map pics", url: "https://old-world-map-pics.com" },
			{ label: "Discord", url: "https://discord.gg/example" },
		];
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}`,
				as: t.admin,
				body: { links },
			}),
		);
		const detail = await getDetail(t.slug, t.admin);
		expect(detail.links).toEqual(links);
	});

	it("replaces the whole list on each patch", async () => {
		const t = await makeTournament();
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}`,
				as: t.admin,
				body: { links: [{ label: "One", url: "https://one.example" }] },
			}),
		);
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}`,
				as: t.admin,
				body: { links: [{ label: "Two", url: "https://two.example" }] },
			}),
		);
		const detail = await getDetail(t.slug, t.admin);
		expect(detail.links).toEqual([{ label: "Two", url: "https://two.example" }]);
	});

	it("rejects a javascript: url (scheme guard)", async () => {
		const t = await makeTournament();
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			// eslint-disable-next-line no-script-url
			body: { links: [{ label: "evil", url: "javascript:alert(1)" }] },
		});
		await expectErrorCode(res, { status: 400, code: "INVALID_BODY" });
	});

	it("rejects a non-url string", async () => {
		const t = await makeTournament();
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: { links: [{ label: "bad", url: "not a url" }] },
		});
		await expectErrorCode(res, { status: 400, code: "INVALID_BODY" });
	});

	it("rejects an empty label", async () => {
		const t = await makeTournament();
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: { links: [{ label: "  ", url: "https://example.com" }] },
		});
		await expectErrorCode(res, { status: 400, code: "INVALID_BODY" });
	});

	it("rejects more than 16 links", async () => {
		const t = await makeTournament();
		const links: Link[] = Array.from({ length: 17 }, (_, i) => ({
			label: `Link ${i}`,
			url: `https://example.com/${i}`,
		}));
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: { links },
		});
		await expectErrorCode(res, { status: 400, code: "INVALID_BODY" });
	});

	it("rejects a non-admin", async () => {
		const t = await makeTournament();
		const stranger = await makeUser();
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: stranger,
			body: { links: [{ label: "x", url: "https://example.com" }] },
		});
		await expectErrorCode(res, { status: 403, code: "NOT_TOURNAMENT_ADMIN" });
	});

	it("stays editable after the tournament leaves setup (not locked)", async () => {
		const t = await makeTournament({ advanceTo: "swiss-round-1-generated" });
		await expectOk(
			await request.patch({
				path: `/v1/tournaments/${t.tournamentId}`,
				as: t.admin,
				body: { links: [{ label: "VOD", url: "https://youtube.com/watch" }] },
			}),
		);
		const detail = await getDetail(t.slug, t.admin);
		expect(detail.links).toEqual([
			{ label: "VOD", url: "https://youtube.com/watch" },
		]);
	});
});
