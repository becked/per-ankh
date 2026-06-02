// POST /v1/tournaments — anyone signed in can create a tournament, the
// creator becomes the sole admin, and the slug is unique-gated. Security
// surface: rate limit, reserved slugs, strict map_script validation,
// slug-collision race.

import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { expectErrorCode, expectOk } from "../../helpers/assertions";
import { makeUser } from "../../helpers/builders";
import { request } from "../../helpers/requests";
import { TOURNAMENT_CREATE_PER_USER_PER_HOUR } from "../../../src/tournament/limits";

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
});

const VALID_MAP = "MAPCLASS_MapScriptDonut";
const VALID_MAP_2 = "MAPCLASS_MapScriptContinent";

// Build a map_pool create payload from scripts (options default-filled server-
// side). The same script may appear more than once.
function pool(
	...scripts: string[]
): { script: string; options?: Record<string, string | boolean> }[] {
	return scripts.map((script) => ({ script }));
}

function uniqueSlug(prefix: string): string {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

interface MapPoolEntryInput {
	id?: string;
	script: string;
	options?: Record<string, string | boolean>;
}

interface CreateBody {
	name: string;
	map_pool?: MapPoolEntryInput[];
	slug?: string;
	description?: string;
	division_a_name?: string;
	division_b_name?: string;
	swiss_max_rounds?: number;
	swiss_wins_to_advance?: number;
	swiss_losses_to_eliminate?: number;
}

interface TournamentResponse {
	tournament: {
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
		created_at: string;
		updated_at: string;
	};
}

async function seedCreateEvents(userId: string, count: number): Promise<void> {
	for (let i = 0; i < count; i++) {
		await env.SHARE_DB.prepare(
			`INSERT INTO events (event_type, user_id, metadata)
			 VALUES ('tournament_create', ?, ?)`,
		)
			.bind(userId, JSON.stringify({ seed: true, index: i }))
			.run();
	}
}

describe("POST /v1/tournaments — auth", () => {
	it("returns 401 when no session cookie is present", async () => {
		const res = await request.post({
			path: "/v1/tournaments",
			body: {
				slug: uniqueSlug("anon"),
				name: "Anon",
				map_pool: pool(VALID_MAP),
			} satisfies CreateBody,
		});
		await expectErrorCode(res, {
			status: 401,
			code: "UNAUTHORIZED",
		});
	});

	it("returns 403 TOURNAMENT_CREATE_FORBIDDEN for a non-allowlisted user", async () => {
		const stranger = await makeUser({ omitBeta: true });
		const res = await request.post({
			path: "/v1/tournaments",
			as: stranger,
			body: {
				slug: uniqueSlug("nonbeta"),
				name: "Non-beta",
				map_pool: pool(VALID_MAP),
			} satisfies CreateBody,
		});
		await expectErrorCode(res, {
			status: 403,
			code: "TOURNAMENT_CREATE_FORBIDDEN",
		});
	});
});

describe("POST /v1/tournaments — happy path", () => {
	it("creates the tournament, inserts a tournament_admins row, and emits a tournament_create event", async () => {
		const user = await makeUser();
		const slug = uniqueSlug("happy");
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				slug,
				name: "Happy Path Open",
				map_pool: pool(VALID_MAP, VALID_MAP_2),
				description: "A test",
				division_a_name: "Custom A",
				division_b_name: "Custom B",
				swiss_max_rounds: 7,
				swiss_wins_to_advance: 4,
				swiss_losses_to_eliminate: 2,
			} satisfies CreateBody,
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as TournamentResponse;
		expect(body.tournament.slug).toBe(slug);
		expect(body.tournament.name).toBe("Happy Path Open");
		expect(body.tournament.description).toBe("A test");
		expect(body.tournament.status).toBe("setup");
		expect(body.tournament.division_a_name).toBe("Custom A");
		expect(body.tournament.division_b_name).toBe("Custom B");
		expect(body.tournament.swiss_max_rounds).toBe(7);
		expect(body.tournament.swiss_wins_to_advance).toBe(4);
		expect(body.tournament.swiss_losses_to_eliminate).toBe(2);
		expect(body.tournament.map_pool.map((e) => e.script)).toEqual([
			VALID_MAP,
			VALID_MAP_2,
		]);
		// Server assigns an id to each entry.
		expect(body.tournament.map_pool.every((e) => e.id.length > 0)).toBe(true);
		expect(body.tournament.slot_counts).toEqual({ swiss: 0, championship: 0 });
		expect(body.tournament.is_viewer_admin).toBe(true);

		// tournament_admins row exists for the creator
		const adminRow = await env.SHARE_DB.prepare(
			`SELECT user_id FROM tournament_admins WHERE tournament_id = ?`,
		)
			.bind(body.tournament.tournament_id)
			.first<{ user_id: string }>();
		expect(adminRow?.user_id).toBe(user.userId);

		// tournament_create event recorded for rate-limit accounting
		const events = await env.SHARE_DB.prepare(
			`SELECT COUNT(*) AS n FROM events
			 WHERE event_type = 'tournament_create' AND user_id = ?`,
		)
			.bind(user.userId)
			.first<{ n: number }>();
		expect(events?.n).toBeGreaterThanOrEqual(1);
	});

	it("applies migration defaults when optional fields are omitted", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				slug: uniqueSlug("defaults"),
				name: "Defaults",
				map_pool: pool(VALID_MAP),
			} satisfies CreateBody,
		});
		const body = await expectOk<TournamentResponse>(res);
		expect(body.tournament.description).toBeNull();
		expect(body.tournament.division_a_name).toBe("Division A");
		expect(body.tournament.division_b_name).toBe("Division B");
		expect(body.tournament.swiss_max_rounds).toBe(5);
		expect(body.tournament.swiss_wins_to_advance).toBe(3);
		expect(body.tournament.swiss_losses_to_eliminate).toBe(3);
	});
});

describe("POST /v1/tournaments — validation", () => {
	it("rejects an invalid slug shape", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				slug: "Has Caps",
				name: "Bad slug",
				map_pool: pool(VALID_MAP),
			} satisfies CreateBody,
		});
		await expectErrorCode(res, { status: 400, code: "INVALID_BODY" });
	});

	it("rejects a reserved slug", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				slug: "new",
				name: "Reserved",
				map_pool: pool(VALID_MAP),
			} satisfies CreateBody,
		});
		await expectErrorCode(res, { status: 400, code: "SLUG_RESERVED" });
	});

	it("accepts an empty map pool (admin configures maps on the tournament page)", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				slug: uniqueSlug("nomaps"),
				name: "No maps",
				map_pool: [],
			} satisfies CreateBody,
		});
		const body = await expectOk<TournamentResponse>(res);
		expect(body.tournament.map_pool).toEqual([]);
	});

	it("accepts a body that omits map_pool entirely", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				slug: uniqueSlug("nomapsfield"),
				name: "Omitted maps",
			} satisfies CreateBody,
		});
		const body = await expectOk<TournamentResponse>(res);
		expect(body.tournament.map_pool).toEqual([]);
	});

	it("rejects a non-canonical map_script value", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				slug: uniqueSlug("badmap"),
				name: "Bad map",
				map_pool: pool("MAPCLASS_ARID_PLATEAU"),
			} satisfies CreateBody,
		});
		await expectErrorCode(res, { status: 400, code: "INVALID_BODY" });
	});
});

describe("POST /v1/tournaments — map pool options", () => {
	it("pre-populates options for every entry with XML defaults when none supplied", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				slug: uniqueSlug("opts-defaults"),
				name: "Opts Defaults",
				map_pool: pool(VALID_MAP, VALID_MAP_2),
			} satisfies CreateBody,
		});
		const body = await expectOk<TournamentResponse>(res);
		const donut = body.tournament.map_pool.find((e) => e.script === VALID_MAP);
		const continent = body.tournament.map_pool.find(
			(e) => e.script === VALID_MAP_2,
		);
		expect(donut).toBeDefined();
		expect(continent).toBeDefined();
		// Donut's XML defaults from canonical-map-options.ts
		expect(donut!.options).toMatchObject({
			MAP_OPTIONS_MULTI_RESOURCE_DENSITY: "MAP_OPTION_MEDIUM_RESOURCES",
			MAP_OPTIONS_DONUT_IRREGULARITY: "MAP_OPTION_DONUT_IRREGULARITY_MEDIUM",
			MAP_OPTIONS_SINGLE_POINT_SYMMETRY: false,
		});
		expect(continent!.options.MAP_OPTIONS_MULTI_RESOURCE_DENSITY).toBe(
			"MAP_OPTION_MEDIUM_RESOURCES",
		);
	});

	it("accepts per-entry overrides and merges them into the defaults", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				slug: uniqueSlug("opts-override"),
				name: "Opts Override",
				map_pool: [
					{
						script: VALID_MAP,
						options: {
							MAP_OPTIONS_DONUT_IRREGULARITY:
								"MAP_OPTION_DONUT_IRREGULARITY_HIGH",
							MAP_OPTIONS_SINGLE_POINT_SYMMETRY: true,
						},
					},
				],
			} satisfies CreateBody,
		});
		const body = await expectOk<TournamentResponse>(res);
		const donut = body.tournament.map_pool[0].options;
		expect(donut.MAP_OPTIONS_DONUT_IRREGULARITY).toBe(
			"MAP_OPTION_DONUT_IRREGULARITY_HIGH",
		);
		expect(donut.MAP_OPTIONS_SINGLE_POINT_SYMMETRY).toBe(true);
		// Unset options still get XML default
		expect(donut.MAP_OPTIONS_MULTI_RESOURCE_DENSITY).toBe(
			"MAP_OPTION_MEDIUM_RESOURCES",
		);
	});

	it("allows the same script multiple times with different options", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				slug: uniqueSlug("opts-dups"),
				name: "Opts Dups",
				map_pool: [
					{ script: VALID_MAP_2, options: { MAPSIZE: "MAPSIZE_SMALLEST" } },
					{ script: VALID_MAP_2, options: { MAPSIZE: "MAPSIZE_TINY" } },
				],
			} satisfies CreateBody,
		});
		const body = await expectOk<TournamentResponse>(res);
		expect(body.tournament.map_pool).toHaveLength(2);
		expect(body.tournament.map_pool.map((e) => e.script)).toEqual([
			VALID_MAP_2,
			VALID_MAP_2,
		]);
		expect(body.tournament.map_pool[0].options.MAPSIZE).toBe(
			"MAPSIZE_SMALLEST",
		);
		expect(body.tournament.map_pool[1].options.MAPSIZE).toBe("MAPSIZE_TINY");
		// Distinct instance ids.
		expect(body.tournament.map_pool[0].id).not.toBe(
			body.tournament.map_pool[1].id,
		);
	});

	it("rejects an option that doesn't apply to its script", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				slug: uniqueSlug("opts-misapplied"),
				name: "Opts Misapplied",
				map_pool: [
					{
						// Donut doesn't register DOTA_RIVER_WIDTH
						script: VALID_MAP,
						options: {
							MAP_OPTIONS_MULTI_DOTA_RIVER_WIDTH: "MAP_OPTION_RIVER_WIDE",
						},
					},
				],
			} satisfies CreateBody,
		});
		await expectErrorCode(res, { status: 400, code: "MAP_OPTIONS_INVALID" });
	});

	it("rejects a select option with a value outside its choices", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				slug: uniqueSlug("opts-badchoice"),
				name: "Opts Bad Choice",
				map_pool: [
					{
						script: VALID_MAP,
						options: {
							MAP_OPTIONS_DONUT_IRREGULARITY: "MAP_OPTION_NOT_A_REAL_CHOICE",
						},
					},
				],
			} satisfies CreateBody,
		});
		await expectErrorCode(res, { status: 400, code: "MAP_OPTIONS_INVALID" });
	});

	it("rejects a toggle option with a string value", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				slug: uniqueSlug("opts-badbool"),
				name: "Opts Bad Bool",
				map_pool: [
					{
						script: VALID_MAP,
						options: {
							MAP_OPTIONS_SINGLE_POINT_SYMMETRY: "yes",
						},
					},
				],
			} satisfies CreateBody,
		});
		await expectErrorCode(res, { status: 400, code: "MAP_OPTIONS_INVALID" });
	});
});

describe("POST /v1/tournaments — server-derived slug", () => {
	it("derives a kebab-case slug from the name when slug is omitted", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				name: `Old World Open ${uniqueSlug("noslug")}`,
				map_pool: pool(VALID_MAP),
			} satisfies CreateBody,
		});
		const body = await expectOk<TournamentResponse>(res);
		expect(body.tournament.slug).toMatch(/^old-world-open-noslug-[a-z0-9]+$/);
	});

	it("appends a short suffix on collision instead of failing", async () => {
		const user = await makeUser();
		// First with explicit slug to plant the collision target.
		const baseSlug = uniqueSlug("collide");
		const name = baseSlug.replace(/-/g, " "); // name derives to baseSlug
		await expectOk(
			await request.post({
				path: "/v1/tournaments",
				as: user,
				body: {
					slug: baseSlug,
					name: "Planted",
					map_pool: pool(VALID_MAP),
				} satisfies CreateBody,
			}),
		);
		// Now without a slug — derives to the same base, must disambiguate.
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: { name, map_pool: pool(VALID_MAP) } satisfies CreateBody,
		});
		const body = await expectOk<TournamentResponse>(res);
		expect(body.tournament.slug).not.toBe(baseSlug);
		expect(body.tournament.slug.startsWith(`${baseSlug}-`)).toBe(true);
	});

	it("falls back to a 'tournament' base when the name is all non-alphanumeric", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				name: "!!!",
				map_pool: pool(VALID_MAP),
			} satisfies CreateBody,
		});
		const body = await expectOk<TournamentResponse>(res);
		// First fallback name is "tournament"; any further callers get
		// "tournament-<suffix>". Both are acceptable here.
		expect(body.tournament.slug).toMatch(/^tournament(-[a-z0-9]+)?$/);
	});

	it("disambiguates a name that derives to a reserved slug", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				name: "New",
				map_pool: pool(VALID_MAP),
			} satisfies CreateBody,
		});
		const body = await expectOk<TournamentResponse>(res);
		expect(body.tournament.slug).not.toBe("new");
		expect(body.tournament.slug.startsWith("new-")).toBe(true);
	});
});

describe("POST /v1/tournaments — slug uniqueness", () => {
	it("returns 409 SLUG_TAKEN when the slug already exists", async () => {
		const user1 = await makeUser();
		const user2 = await makeUser();
		const slug = uniqueSlug("dup");
		await expectOk(
			await request.post({
				path: "/v1/tournaments",
				as: user1,
				body: {
					slug,
					name: "First",
					map_pool: pool(VALID_MAP),
				} satisfies CreateBody,
			}),
		);
		const res = await request.post({
			path: "/v1/tournaments",
			as: user2,
			body: {
				slug,
				name: "Second",
				map_pool: pool(VALID_MAP),
			} satisfies CreateBody,
		});
		await expectErrorCode(res, { status: 409, code: "SLUG_TAKEN" });
	});
});

describe("POST /v1/tournaments — rate limit", () => {
	it("rejects the next create once the user is at the per-hour budget", async () => {
		const user = await makeUser();
		await seedCreateEvents(user.userId, TOURNAMENT_CREATE_PER_USER_PER_HOUR);
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				slug: uniqueSlug("ratelimit"),
				name: "Over limit",
				map_pool: pool(VALID_MAP),
			} satisfies CreateBody,
		});
		await expectErrorCode(res, {
			status: 429,
			code: "RATE_LIMIT_TOURNAMENT_CREATE",
		});
	});

	it("allows one more create just below the budget", async () => {
		const user = await makeUser();
		await seedCreateEvents(
			user.userId,
			TOURNAMENT_CREATE_PER_USER_PER_HOUR - 1,
		);
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				slug: uniqueSlug("under"),
				name: "Under limit",
				map_pool: pool(VALID_MAP),
			} satisfies CreateBody,
		});
		expect(res.status).toBe(201);
	});

	it("rate limit is per-user — another user is unaffected", async () => {
		const user1 = await makeUser();
		const user2 = await makeUser();
		await seedCreateEvents(user1.userId, TOURNAMENT_CREATE_PER_USER_PER_HOUR);
		const res = await request.post({
			path: "/v1/tournaments",
			as: user2,
			body: {
				slug: uniqueSlug("otheruser"),
				name: "Other user",
				map_pool: pool(VALID_MAP),
			} satisfies CreateBody,
		});
		expect(res.status).toBe(201);
	});
});

describe("POST /v1/tournaments — content-type hardening", () => {
	it("rejects text/plain Content-Type as 415", async () => {
		const user = await makeUser();
		const res = await SELF.fetch("http://test/v1/tournaments", {
			method: "POST",
			headers: {
				Origin: "http://localhost:1420",
				Cookie: `session=${user.sessionToken}`,
				"Content-Type": "text/plain",
			},
			body: JSON.stringify({
				slug: uniqueSlug("ct"),
				name: "x",
				map_pool: pool(VALID_MAP),
			}),
		});
		await expectErrorCode(res, {
			status: 415,
			code: "UNSUPPORTED_MEDIA_TYPE",
		});
	});
});
