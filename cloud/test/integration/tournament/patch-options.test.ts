// Behavior tests for PATCH /v1/tournaments/:id with map_pool.
//
// Covers: per-instance option pre-population + override, adding/removing
// instances, validation of options against an instance's script, and the
// locked-after-setup guard.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeTournament, type TestUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

const DONUT = "MAPCLASS_MapScriptDonut";
const CONTINENT = "MAPCLASS_MapScriptContinent";
const DOTA = "MAPCLASS_MapScriptDota";

interface MapPoolEntry {
	id: string;
	script: string;
	options: Record<string, string | boolean>;
}
interface DetailResponse {
	map_pool: MapPoolEntry[];
}

// Setup-status tournaments are admin-only on the detail endpoint, so the
// tests authenticate as the admin to read back state. After the tournament
// leaves setup, anonymous reads work — but every test in this file is on a
// setup-state tournament except the locked-after-setup one.
async function getDetail(slug: string, as: TestUser): Promise<DetailResponse> {
	const res = await request.get({ path: `/v1/tournaments/${slug}`, as });
	return await expectOk<DetailResponse>(res);
}

function entryFor(pool: MapPoolEntry[], script: string): MapPoolEntry {
	const hit = pool.find((e) => e.script === script);
	if (!hit) throw new Error(`no pool entry for ${script}`);
	return hit;
}

describe("PATCH /v1/tournaments/:id — map_pool", () => {
	it("patches a single instance's options on a setup tournament", async () => {
		const t = await makeTournament({ allowedMaps: [DONUT, CONTINENT] });
		const before = await getDetail(t.slug, t.admin);
		const donut = entryFor(before.map_pool, DONUT);
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: {
				map_pool: before.map_pool.map((e) =>
					e.id === donut.id
						? {
								id: e.id,
								script: e.script,
								options: {
									MAP_OPTIONS_DONUT_IRREGULARITY:
										"MAP_OPTION_DONUT_IRREGULARITY_HIGH",
									MAP_OPTIONS_SINGLE_POINT_SYMMETRY: true,
								},
							}
						: { id: e.id, script: e.script, options: e.options },
				),
			},
		});
		await expectOk(res);
		const detail = await getDetail(t.slug, t.admin);
		const donutAfter = entryFor(detail.map_pool, DONUT);
		expect(donutAfter.options.MAP_OPTIONS_DONUT_IRREGULARITY).toBe(
			"MAP_OPTION_DONUT_IRREGULARITY_HIGH",
		);
		expect(donutAfter.options.MAP_OPTIONS_SINGLE_POINT_SYMMETRY).toBe(true);
		// The other instance still has its XML defaults populated.
		const continentAfter = entryFor(detail.map_pool, CONTINENT);
		expect(continentAfter.options.MAP_OPTIONS_MULTI_RESOURCE_DENSITY).toBe(
			"MAP_OPTION_MEDIUM_RESOURCES",
		);
	});

	it("removes an instance when it's dropped from the patched pool", async () => {
		const t = await makeTournament({ allowedMaps: [DONUT, CONTINENT] });
		const before = await getDetail(t.slug, t.admin);
		const continent = entryFor(before.map_pool, CONTINENT);
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: {
				map_pool: [{ id: continent.id, script: continent.script }],
			},
		});
		await expectOk(res);
		const detail = await getDetail(t.slug, t.admin);
		expect(detail.map_pool.map((e) => e.script)).toEqual([CONTINENT]);
	});

	it("pre-populates options for a newly-added instance", async () => {
		const t = await makeTournament({ allowedMaps: [DONUT] });
		const before = await getDetail(t.slug, t.admin);
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: {
				map_pool: [
					...before.map_pool.map((e) => ({ id: e.id, script: e.script })),
					{ script: DOTA },
				],
			},
		});
		await expectOk(res);
		const detail = await getDetail(t.slug, t.admin);
		expect(detail.map_pool.map((e) => e.script).sort()).toEqual(
			[DONUT, DOTA].sort(),
		);
		// Dota's XML defaults
		expect(entryFor(detail.map_pool, DOTA).options).toMatchObject({
			MAP_OPTIONS_MULTI_DOTA_BOUNDARY_TERRAIN: "MAP_OPTION_TERRAIN_JUNGLE",
			MAP_OPTIONS_MULTI_DOTA_RIVER_WIDTH: "MAP_OPTION_RIVER_NARROW",
		});
	});

	it("allows the same script twice with different options", async () => {
		const t = await makeTournament({ allowedMaps: [CONTINENT] });
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: {
				map_pool: [
					{ script: CONTINENT, options: { MAPSIZE: "MAPSIZE_SMALLEST" } },
					{ script: CONTINENT, options: { MAPSIZE: "MAPSIZE_TINY" } },
				],
			},
		});
		await expectOk(res);
		const detail = await getDetail(t.slug, t.admin);
		expect(detail.map_pool).toHaveLength(2);
		expect(detail.map_pool.map((e) => e.options.MAPSIZE).sort()).toEqual([
			"MAPSIZE_SMALLEST",
			"MAPSIZE_TINY",
		]);
		expect(detail.map_pool[0].id).not.toBe(detail.map_pool[1].id);
	});

	it("rejects an option that doesn't apply to its instance's script", async () => {
		const t = await makeTournament({ allowedMaps: [DONUT] });
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: {
				map_pool: [
					{
						script: DONUT,
						options: {
							MAP_OPTIONS_MULTI_DOTA_RIVER_WIDTH: "MAP_OPTION_RIVER_WIDE",
						},
					},
				],
			},
		});
		await expectErrorCode(res, { status: 400, code: "MAP_OPTIONS_INVALID" });
	});

	it("rejects editing an existing map_pool entry after the tournament leaves setup", async () => {
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
			allowedMaps: [DONUT],
		});
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: {
				map_pool: [
					{
						script: DONUT,
						options: {
							MAP_OPTIONS_DONUT_IRREGULARITY:
								"MAP_OPTION_DONUT_IRREGULARITY_LOW",
						},
					},
				],
			},
		});
		await expectErrorCode(res, { status: 409, code: "MAP_POOL_LOCKED" });
	});

	it("swaps the pool to a different script and configures it in one call", async () => {
		const t = await makeTournament({ allowedMaps: [DONUT] });
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: {
				map_pool: [
					{
						script: DOTA,
						options: {
							MAP_OPTIONS_MULTI_DOTA_RIVER_WIDTH: "MAP_OPTION_RIVER_WIDE",
						},
					},
				],
			},
		});
		await expectOk(res);
		const detail = await getDetail(t.slug, t.admin);
		expect(detail.map_pool.map((e) => e.script)).toEqual([DOTA]);
		expect(
			entryFor(detail.map_pool, DOTA).options
				.MAP_OPTIONS_MULTI_DOTA_RIVER_WIDTH,
		).toBe("MAP_OPTION_RIVER_WIDE");
	});
});
