// Behavior tests for PATCH /v1/tournaments/:id with map_script_options.
//
// Covers: pre-population, validation against allowed_map_scripts,
// reconciliation when allowed_map_scripts changes, and the locked-after-
// setup guard.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import {
	makeTournament,
	makeUser,
	type TestUser,
} from "../../helpers/builders";
import { request } from "../../helpers/requests";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

const DONUT = "MAPCLASS_MapScriptDonut";
const CONTINENT = "MAPCLASS_MapScriptContinent";
const DOTA = "MAPCLASS_MapScriptDota";

interface DetailResponse {
	allowed_map_scripts: string[];
	map_script_options: Record<string, Record<string, string | boolean>>;
}

// Setup-status tournaments are admin-only on the detail endpoint, so the
// tests authenticate as the admin to read back state. After the tournament
// leaves setup, anonymous reads work — but every test in this file is on a
// setup-state tournament except the locked-after-setup one.
async function getDetail(slug: string, as: TestUser): Promise<DetailResponse> {
	const res = await request.get({ path: `/v1/tournaments/${slug}`, as });
	return await expectOk<DetailResponse>(res);
}

describe("PATCH /v1/tournaments/:id — map_script_options", () => {
	it("patches a single script's options on a setup tournament", async () => {
		const t = await makeTournament({ allowedMaps: [DONUT, CONTINENT] });
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: {
				map_script_options: {
					[DONUT]: {
						MAP_OPTIONS_DONUT_IRREGULARITY:
							"MAP_OPTION_DONUT_IRREGULARITY_HIGH",
						MAP_OPTIONS_SINGLE_POINT_SYMMETRY: true,
					},
				},
			},
		});
		await expectOk(res);
		const detail = await getDetail(t.slug, t.admin);
		expect(
			detail.map_script_options[DONUT].MAP_OPTIONS_DONUT_IRREGULARITY,
		).toBe("MAP_OPTION_DONUT_IRREGULARITY_HIGH");
		expect(
			detail.map_script_options[DONUT].MAP_OPTIONS_SINGLE_POINT_SYMMETRY,
		).toBe(true);
		// Other allowed script still has its XML defaults populated.
		expect(detail.map_script_options[CONTINENT]).toBeDefined();
		expect(
			detail.map_script_options[CONTINENT].MAP_OPTIONS_MULTI_RESOURCE_DENSITY,
		).toBe("MAP_OPTION_MEDIUM_RESOURCES");
	});

	it("garbage-collects options for a script removed from allowed_map_scripts", async () => {
		const t = await makeTournament({ allowedMaps: [DONUT, CONTINENT] });
		// Pre-customize Donut's options
		await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: {
				map_script_options: {
					[DONUT]: {
						MAP_OPTIONS_DONUT_IRREGULARITY:
							"MAP_OPTION_DONUT_IRREGULARITY_HIGH",
					},
				},
			},
		});
		// Now remove Donut from the allowed list
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: { allowed_map_scripts: [CONTINENT] },
		});
		await expectOk(res);
		const detail = await getDetail(t.slug, t.admin);
		expect(detail.allowed_map_scripts).toEqual([CONTINENT]);
		expect(Object.keys(detail.map_script_options)).toEqual([CONTINENT]);
	});

	it("pre-populates options for a newly-added script", async () => {
		const t = await makeTournament({ allowedMaps: [DONUT] });
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: { allowed_map_scripts: [DONUT, DOTA] },
		});
		await expectOk(res);
		const detail = await getDetail(t.slug, t.admin);
		expect(Object.keys(detail.map_script_options).sort()).toEqual(
			[DONUT, DOTA].sort(),
		);
		// Dota's XML defaults
		expect(detail.map_script_options[DOTA]).toMatchObject({
			MAP_OPTIONS_MULTI_DOTA_BOUNDARY_TERRAIN: "MAP_OPTION_TERRAIN_JUNGLE",
			MAP_OPTIONS_MULTI_DOTA_RIVER_WIDTH: "MAP_OPTION_RIVER_NARROW",
		});
	});

	it("rejects map_script_options patch with options for a not-allowed script", async () => {
		const t = await makeTournament({ allowedMaps: [DONUT] });
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: {
				map_script_options: {
					[DOTA]: {
						MAP_OPTIONS_MULTI_DOTA_RIVER_WIDTH: "MAP_OPTION_RIVER_WIDE",
					},
				},
			},
		});
		await expectErrorCode(res, { status: 400, code: "MAP_OPTIONS_INVALID" });
	});

	it("locks map_script_options after the tournament leaves setup", async () => {
		const t = await makeTournament({
			advanceTo: "swiss-round-1-generated",
			allowedMaps: [DONUT],
		});
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: {
				map_script_options: {
					[DONUT]: {
						MAP_OPTIONS_DONUT_IRREGULARITY: "MAP_OPTION_DONUT_IRREGULARITY_LOW",
					},
				},
			},
		});
		await expectErrorCode(res, { status: 409, code: "TOURNAMENT_LOCKED" });
	});

	it("validates options against the new allowed list when both fields are patched together", async () => {
		const t = await makeTournament({ allowedMaps: [DONUT] });
		// Caller wants to swap Donut for Dota and configure Dota in the same call.
		const res = await request.patch({
			path: `/v1/tournaments/${t.tournamentId}`,
			as: t.admin,
			body: {
				allowed_map_scripts: [DOTA],
				map_script_options: {
					[DOTA]: {
						MAP_OPTIONS_MULTI_DOTA_RIVER_WIDTH: "MAP_OPTION_RIVER_WIDE",
					},
				},
			},
		});
		await expectOk(res);
		const detail = await getDetail(t.slug, t.admin);
		expect(detail.allowed_map_scripts).toEqual([DOTA]);
		expect(
			detail.map_script_options[DOTA].MAP_OPTIONS_MULTI_DOTA_RIVER_WIDTH,
		).toBe("MAP_OPTION_RIVER_WIDE");
	});
});
