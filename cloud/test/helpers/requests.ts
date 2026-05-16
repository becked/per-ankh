// Test request helpers — wrap SELF.fetch with auth + JSON conventions.
//
// Tests read like:
//
//   const res = await asAdmin.patch({
//     path: `/v1/tournaments/${t.tournamentId}/matches/${m.matchId}/pairing`,
//     as: t.admin,
//     body: { slot_a_id: otherT.slotsByDivision.A[0].slotId },
//   });
//
// The `as` field names the actor (admin, player, anonymous via omission).

import { SELF } from "cloudflare:test";

// Duck-typed: any object with a sessionToken satisfies this. TestUser from
// builders.ts has it. Keeps requests.ts free of import cycles with builders.
interface AuthedUser {
	readonly sessionToken: string;
}

export interface RequestOpts {
	readonly path: string;
	readonly body?: unknown;
	readonly as?: AuthedUser;
	readonly origin?: string;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

const DEFAULT_ORIGIN = "http://localhost:1420";

async function send(method: Method, opts: RequestOpts): Promise<Response> {
	const headers: Record<string, string> = {
		Origin: opts.origin ?? DEFAULT_ORIGIN,
	};
	if (opts.as) {
		headers["Cookie"] = `session=${opts.as.sessionToken}`;
	}

	// Mirror the cloud frontend: POST/PATCH always send Content-Type JSON
	// and at least an empty object body. Several handlers call parseJsonBody
	// which 400s on missing/empty bodies. GET/DELETE have no body.
	let body: string | undefined;
	if (method === "POST" || method === "PATCH") {
		headers["Content-Type"] = "application/json";
		body = JSON.stringify(opts.body ?? {});
	} else if (opts.body !== undefined) {
		headers["Content-Type"] = "application/json";
		body = JSON.stringify(opts.body);
	}

	// Host doesn't matter — SELF.fetch routes through the worker's fetch handler.
	return SELF.fetch(`http://test${opts.path}`, { method, headers, body });
}

export const request = {
	get: (opts: RequestOpts) => send("GET", opts),
	post: (opts: RequestOpts) => send("POST", opts),
	patch: (opts: RequestOpts) => send("PATCH", opts),
	delete: (opts: RequestOpts) => send("DELETE", opts),
} as const;

export interface MultipartOpts {
	readonly path: string;
	readonly form: FormData;
	readonly as?: AuthedUser;
	readonly origin?: string;
}

// Posts a multipart/form-data body. The runtime generates the
// Content-Type header (with the boundary) from the FormData body —
// don't override it.
export async function postMultipart(opts: MultipartOpts): Promise<Response> {
	const headers: Record<string, string> = {
		Origin: opts.origin ?? DEFAULT_ORIGIN,
	};
	if (opts.as) {
		headers["Cookie"] = `session=${opts.as.sessionToken}`;
	}
	return SELF.fetch(`http://test${opts.path}`, {
		method: "POST",
		headers,
		body: opts.form,
	});
}
