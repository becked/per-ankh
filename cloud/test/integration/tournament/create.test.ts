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

function uniqueSlug(prefix: string): string {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

interface CreateBody {
	name: string;
	allowed_map_scripts: string[];
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
		allowed_map_scripts: string[];
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
				allowed_map_scripts: [VALID_MAP],
			} satisfies CreateBody,
		});
		await expectErrorCode(res, { status: 401, code: "UNAUTHORIZED" });
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
				allowed_map_scripts: [VALID_MAP, VALID_MAP_2],
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
		expect(body.tournament.allowed_map_scripts).toEqual([
			VALID_MAP,
			VALID_MAP_2,
		]);
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
				allowed_map_scripts: [VALID_MAP],
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
				allowed_map_scripts: [VALID_MAP],
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
				allowed_map_scripts: [VALID_MAP],
			} satisfies CreateBody,
		});
		await expectErrorCode(res, { status: 400, code: "SLUG_RESERVED" });
	});

	it("rejects an empty map list", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				slug: uniqueSlug("nomaps"),
				name: "No maps",
				allowed_map_scripts: [],
			} satisfies CreateBody,
		});
		await expectErrorCode(res, { status: 400, code: "INVALID_BODY" });
	});

	it("rejects a non-canonical map_script value", async () => {
		const user = await makeUser();
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: {
				slug: uniqueSlug("badmap"),
				name: "Bad map",
				allowed_map_scripts: ["MAPCLASS_ARID_PLATEAU"],
			} satisfies CreateBody,
		});
		await expectErrorCode(res, { status: 400, code: "INVALID_BODY" });
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
				allowed_map_scripts: [VALID_MAP],
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
					allowed_map_scripts: [VALID_MAP],
				} satisfies CreateBody,
			}),
		);
		// Now without a slug — derives to the same base, must disambiguate.
		const res = await request.post({
			path: "/v1/tournaments",
			as: user,
			body: { name, allowed_map_scripts: [VALID_MAP] } satisfies CreateBody,
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
				allowed_map_scripts: [VALID_MAP],
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
				allowed_map_scripts: [VALID_MAP],
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
					allowed_map_scripts: [VALID_MAP],
				} satisfies CreateBody,
			}),
		);
		const res = await request.post({
			path: "/v1/tournaments",
			as: user2,
			body: {
				slug,
				name: "Second",
				allowed_map_scripts: [VALID_MAP],
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
				allowed_map_scripts: [VALID_MAP],
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
				allowed_map_scripts: [VALID_MAP],
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
				allowed_map_scripts: [VALID_MAP],
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
				allowed_map_scripts: [VALID_MAP],
			}),
		});
		await expectErrorCode(res, {
			status: 415,
			code: "UNSUPPORTED_MEDIA_TYPE",
		});
	});
});
