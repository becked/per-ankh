// POST /v1/query/ask, against real D1 and KV with the model stubbed.
//
// env.AI is replaced in every test, as the screenshot tests do it: the test
// isolate has no AI binding (vitest.config.mts). What is pinned here is what
// the Worker does around the model — the gate, the off switch, the answer
// cache, the limits, the checks and the retry — not what the model answers. The eval
// (scripts/eval-query-ask.ts) is where the model's answers are measured.

import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	ASK_DISABLED_KEY,
	ASK_TEMPERATURE,
	ASK_TOOL_NAME,
} from "../../../src/query/ask";
import { makeUser, type TestUser } from "../../helpers/builders";
import { postMultipart, request } from "../../helpers/requests";
import { buildUploadFormData } from "../../helpers/save-blob";

interface ModelCall {
	model: string;
	inputs: {
		messages: { role: string; content: string | null; tool_call_id?: string }[];
		tool_choice: string;
		store: boolean;
		temperature?: number;
	};
	options: { extraHeaders?: Record<string, string> } | undefined;
}

let calls: ModelCall[] = [];
let replies: (() => unknown)[] = [];

// A chat-completions reply carrying one call of the answer tool.
function toolReply(args: Record<string, unknown>): unknown {
	return {
		id: "chatcmpl-test",
		object: "chat.completion",
		created: 0,
		model: "stub",
		choices: [
			{
				index: 0,
				finish_reason: "tool_calls",
				message: {
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: `call_${calls.length}`,
							type: "function",
							function: {
								name: ASK_TOOL_NAME,
								arguments: JSON.stringify(args),
							},
						},
					],
				},
			},
		],
		usage: { prompt_tokens: 9000, completion_tokens: 120, total_tokens: 9120 },
	};
}

let alice: TestUser;

beforeAll(async () => {
	await applyD1Migrations(env.SHARE_DB, env.TEST_MIGRATIONS);
	// Alice claims seat 0 of a public game, which puts her account on the
	// player roster the ask endpoint matches names against.
	alice = await makeUser({ displayName: "Alice" });
	const res = await postMultipart({
		path: "/v1/games",
		form: await buildUploadFormData({ uploaderIndex: 0, winnerIndex: 0 }),
		as: alice,
	});
	expect(res.status).toBe(201);
});

beforeEach(async () => {
	calls = [];
	replies = [];
	(env as unknown as { AI: unknown }).AI = {
		run: async (
			model: string,
			inputs: ModelCall["inputs"],
			options: ModelCall["options"],
		) => {
			calls.push({ model, inputs, options });
			const next = replies.shift();
			if (!next) throw new Error("no stubbed reply left");
			return next();
		},
	};
	await env.SESSIONS_KV.delete(ASK_DISABLED_KEY);
	// Most tests ask the same question, and each expects the model to answer it.
	const cached = await env.SESSIONS_KV.list({ prefix: "query_ask:answer:" });
	for (const k of cached.keys) await env.SESSIONS_KV.delete(k.name);
	await env.SHARE_DB.prepare(
		`DELETE FROM events WHERE event_type = 'query_ask'`,
	).run();
});

async function ask(
	question: unknown,
	as: TestUser | null = alice,
): Promise<Response> {
	return request.post({
		path: "/v1/query/ask",
		body: { question },
		as: as ?? undefined,
	});
}

async function chargedCalls(): Promise<number> {
	const row = await env.SHARE_DB.prepare(
		`SELECT COUNT(*) AS n FROM events WHERE event_type = 'query_ask'`,
	).first<{ n: number }>();
	return row?.n ?? 0;
}

const WONDERS_BY_PLAYER = {
	kind: "selection",
	source: "wonder_events",
	measure: "wonders_built",
	dimensions: ["player"],
	filters: [{ key: "wonder", op: "in", values: ["IMPROVEMENT_PYRAMIDS"] }],
};

describe("the gate", () => {
	it("refuses an anonymous caller before calling the model", async () => {
		const res = await ask("Who built the Pyramids?", null);
		expect(res.status).toBe(401);
		expect(calls).toHaveLength(0);
	});

	it("refuses an empty question", async () => {
		const res = await ask("   ");
		expect(res.status).toBe(400);
		expect(calls).toHaveLength(0);
	});
});

describe("the off switch", () => {
	it("refuses while the key is set, before calling the model", async () => {
		await env.SESSIONS_KV.put(ASK_DISABLED_KEY, "1");
		const res = await ask("Who built the Pyramids?");
		expect(res.status).toBe(503);
		expect((await res.json<{ code: string }>()).code).toBe("ASK_DISABLED");
		expect(calls).toHaveLength(0);
		expect(await chargedCalls()).toBe(0);
	});

	it("refuses when the switch cannot be read", async () => {
		const kv = env.SESSIONS_KV;
		// Throws for the switch key only, so the session read still works.
		(env as unknown as { SESSIONS_KV: unknown }).SESSIONS_KV = {
			...kv,
			get: (key: string, ...rest: unknown[]) => {
				if (key === ASK_DISABLED_KEY) throw new Error("kv down");
				return (kv.get as (...a: unknown[]) => unknown)(key, ...rest);
			},
		};
		try {
			const res = await ask("Who built the Pyramids?");
			expect(res.status).toBe(503);
			expect((await res.json<{ code: string }>()).code).toBe("ASK_UNAVAILABLE");
			expect(calls).toHaveLength(0);
		} finally {
			(env as unknown as { SESSIONS_KV: unknown }).SESSIONS_KV = kv;
		}
	});
});

describe("a question the model answers", () => {
	it("returns the canonical selection and charges one call", async () => {
		replies = [() => toolReply(WONDERS_BY_PLAYER)];
		const res = await ask("Who built the Pyramids?");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			selection:
				"source=wonder_events&dim=player&measure=wonders_built&f=wonder:in:IMPROVEMENT_PYRAMIDS",
		});
		expect(calls).toHaveLength(1);
		expect(await chargedCalls()).toBe(1);
		expect(calls[0].inputs.tool_choice).toBe("required");
		expect(calls[0].inputs.store).toBe(false);
		expect(calls[0].inputs.temperature).toBe(ASK_TEMPERATURE);
		expect(calls[0].options?.extraHeaders?.["x-session-affinity"]).toBeTruthy();
		// The question travels in the user message, after the shared prefix.
		expect(calls[0].inputs.messages[1].content).toContain(
			"Who built the Pyramids?",
		);
	});

	it("matches a player's name to their account", async () => {
		replies = [
			() =>
				toolReply({
					kind: "selection",
					source: "player_summaries",
					measure: "seats",
					filters: [{ key: "player", op: "in", values: ["alice"] }],
				}),
		];
		const res = await ask("How many games has Alice played?");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			selection: `source=player_summaries&measure=seats&f=player:in:${alice.userId}`,
		});
	});
});

describe("a reply that fails a check", () => {
	it("retries once with the failure and returns the corrected answer", async () => {
		replies = [
			() =>
				toolReply({
					...WONDERS_BY_PLAYER,
					filters: [
						{ key: "wonder", op: "in", values: ["IMPROVEMENT_PYRAMID"] },
					],
				}),
			() => toolReply(WONDERS_BY_PLAYER),
		];
		const res = await ask("Who built the Pyramids?");
		expect(res.status).toBe(200);
		expect(calls).toHaveLength(2);
		// The retry is a second charge.
		expect(await chargedCalls()).toBe(2);
		const retry = calls[1].inputs.messages.at(-1);
		expect(retry?.role).toBe("tool");
		expect(retry?.content).toContain("IMPROVEMENT_PYRAMID");
	});

	it("refuses after a second failure, naming what did not match", async () => {
		replies = [
			() =>
				toolReply({
					kind: "selection",
					source: "player_summaries",
					measure: "seats",
					filters: [{ key: "player", op: "in", values: ["Gilgamesh99"] }],
				}),
			() =>
				toolReply({
					kind: "selection",
					source: "player_summaries",
					measure: "seats",
					filters: [{ key: "player", op: "in", values: ["Gilgamesh99"] }],
				}),
		];
		const res = await ask("How many games has Gilgamesh99 played?");
		expect(res.status).toBe(422);
		const body = await res.json<{ code: string; error: string }>();
		expect(body.code).toBe("ASK_UNMATCHED");
		expect(JSON.stringify(body)).toContain("Gilgamesh99");
		expect(calls).toHaveLength(2);
	});
});

describe("a question the catalog cannot express", () => {
	it("returns the model's reason", async () => {
		replies = [
			() =>
				toolReply({
					kind: "unsupported",
					reason: "No source records religions.",
				}),
		];
		const res = await ask("Which religion gets founded first?");
		expect(res.status).toBe(422);
		const body = await res.json<{ code: string }>();
		expect(body.code).toBe("ASK_UNSUPPORTED");
		expect(JSON.stringify(body)).toContain("No source records religions.");
		expect(calls).toHaveLength(1);
	});
});

describe("the limits", () => {
	it("refuses once the account's hourly calls are spent", async () => {
		const vars = env as unknown as { PER_USER_QUERY_ASKS_PER_HOUR?: string };
		const before = vars.PER_USER_QUERY_ASKS_PER_HOUR;
		vars.PER_USER_QUERY_ASKS_PER_HOUR = "1";
		try {
			replies = [() => toolReply(WONDERS_BY_PLAYER)];
			expect((await ask("Who built the Pyramids?")).status).toBe(200);
			// A different question, so the answer cache cannot answer it.
			const res = await ask("Who built the Colossus?");
			expect(res.status).toBe(429);
			expect((await res.json<{ code: string }>()).code).toBe(
				"RATE_LIMIT_ASK_USER",
			);
			expect(calls).toHaveLength(1);
		} finally {
			vars.PER_USER_QUERY_ASKS_PER_HOUR = before;
		}
	});

	it("refuses once the global hourly calls are spent", async () => {
		const vars = env as unknown as { GLOBAL_QUERY_ASKS_PER_HOUR?: string };
		const before = vars.GLOBAL_QUERY_ASKS_PER_HOUR;
		vars.GLOBAL_QUERY_ASKS_PER_HOUR = "1";
		try {
			replies = [() => toolReply(WONDERS_BY_PLAYER)];
			expect((await ask("Who built the Pyramids?")).status).toBe(200);
			const other = await makeUser();
			const res = await ask("Who built the Colossus?", other);
			expect(res.status).toBe(429);
			expect((await res.json<{ code: string }>()).code).toBe(
				"RATE_LIMIT_ASK_GLOBAL",
			);
		} finally {
			vars.GLOBAL_QUERY_ASKS_PER_HOUR = before;
		}
	});
});

describe("the answer cache", () => {
	const UNMATCHED_PLAYER = {
		kind: "selection",
		source: "player_summaries",
		measure: "seats",
		filters: [{ key: "player", op: "in", values: ["Gilgamesh99"] }],
	};

	it("answers a repeated question with no model call and no charge", async () => {
		replies = [() => toolReply(WONDERS_BY_PLAYER)];
		const first = await ask("Who built the Pyramids?");
		expect(first.status).toBe(200);
		const body = await first.json();
		// Case and whitespace are folded.
		const again = await ask("  who built the   PYRAMIDS? ");
		expect(again.status).toBe(200);
		expect(await again.json()).toEqual(body);
		expect(calls).toHaveLength(1);
		expect(await chargedCalls()).toBe(1);
	});

	it("answers a hit after the account's hourly calls are spent", async () => {
		const vars = env as unknown as { PER_USER_QUERY_ASKS_PER_HOUR?: string };
		const before = vars.PER_USER_QUERY_ASKS_PER_HOUR;
		vars.PER_USER_QUERY_ASKS_PER_HOUR = "1";
		try {
			replies = [() => toolReply(WONDERS_BY_PLAYER)];
			expect((await ask("Who built the Pyramids?")).status).toBe(200);
			expect((await ask("Who built the Pyramids?")).status).toBe(200);
			expect(calls).toHaveLength(1);
		} finally {
			vars.PER_USER_QUERY_ASKS_PER_HOUR = before;
		}
	});

	it("refuses a hit while the off switch is set", async () => {
		replies = [() => toolReply(WONDERS_BY_PLAYER)];
		expect((await ask("Who built the Pyramids?")).status).toBe(200);
		await env.SESSIONS_KV.put(ASK_DISABLED_KEY, "1");
		const res = await ask("Who built the Pyramids?");
		expect(res.status).toBe(503);
		expect((await res.json<{ code: string }>()).code).toBe("ASK_DISABLED");
	});

	it("stores an unsupported reply to the first call", async () => {
		replies = [
			() =>
				toolReply({
					kind: "unsupported",
					reason: "No source records religions.",
				}),
		];
		expect((await ask("Which religion gets founded first?")).status).toBe(422);
		const again = await ask("Which religion gets founded first?");
		expect(again.status).toBe(422);
		expect((await again.json<{ code: string }>()).code).toBe("ASK_UNSUPPORTED");
		expect(calls).toHaveLength(1);
	});

	it("does not store a failure", async () => {
		replies = [
			() => toolReply(UNMATCHED_PLAYER),
			() => toolReply(UNMATCHED_PLAYER),
		];
		const question = "How many games has Gilgamesh99 played?";
		expect((await ask(question)).status).toBe(422);
		replies = [
			() => toolReply({ kind: "unsupported", reason: "No such player." }),
		];
		expect((await ask(question)).status).toBe(422);
		expect(calls).toHaveLength(3);
	});

	it("does not store an unsupported reply after a retry", async () => {
		replies = [
			() => toolReply(UNMATCHED_PLAYER),
			() => toolReply({ kind: "unsupported", reason: "No such player." }),
		];
		const question = "How many games has Gilgamesh99 played?";
		expect((await ask(question)).status).toBe(422);
		replies = [
			() => toolReply({ kind: "unsupported", reason: "No such player." }),
		];
		expect((await ask(question)).status).toBe(422);
		expect(calls).toHaveLength(3);
	});
});

describe("a model that is down", () => {
	it("answers unavailable", async () => {
		replies = [
			() => {
				throw new Error("upstream 500");
			},
		];
		const res = await ask("Who built the Pyramids?");
		expect(res.status).toBe(503);
		expect((await res.json<{ code: string }>()).code).toBe("ASK_UNAVAILABLE");
	});
});
