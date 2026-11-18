// The answer cache for POST /v1/query/ask, in SESSIONS_KV.
//
// A question asked again on the same day is answered from here, with no model
// call and no charge against the hourly limits. The key is a hash of the
// first request the question would send: the model, the prompt, the tool, the
// effort, the temperature, today's date and the question. A deploy that
// changes any of them, or the date changing, makes a new key, so every hit
// was answered by the same request the current code would send. The question
// is folded first (normalizeText: case and runs of whitespace), so "Who built
// the Pyramids?" and "who built  the pyramids?" share an entry.
//
// What is stored:
//   * A selection. It names accounts and tournaments by ID, so a roster that
//     has grown since does not make it wrong.
//   * An "unsupported" reply to the first call. No check had run, so no
//     roster went into it.
// What is not:
//   * An "unsupported" reply after a retry, and a failure. Both can follow a
//     name that matched nobody. That player can upload a game later in the
//     day, and a stored refusal would keep refusing them.
//
// The checks on a reply (checkAnswer) are not in the key. A change to them
// that would change an outcome bumps ASK_CACHE_VERSION. Without the bump, the
// TTL limits the stale answers to one day.
//
// A read or a write that throws is logged and counts as a miss. The cache
// saves model calls, and the limits bound those calls without it.

import { logError } from "../log";
import { sha256Hex } from "../util";
import {
	ASK_MODEL,
	ASK_REASONING_EFFORT,
	ASK_TEMPERATURE,
	askMessages,
	buildAskInputs,
	normalizeText,
	type AskOutcome,
} from "./ask";
import { parseSelection, type QuerySelection } from "./select";

// Bump when the checks change an outcome, or when the stored shape changes.
// Old keys are orphaned and expire.
const ASK_CACHE_VERSION = 1;

// Beside ASK_DISABLED_KEY (`query_ask:disabled`) in the same namespace.
const KEY_PREFIX = `query_ask:answer:v${ASK_CACHE_VERSION}:`;

// One day, because the date is in the key: an entry gets no hits after the
// date changes.
const TTL_SECONDS = 24 * 60 * 60;

export type CachedAnswer =
	| { kind: "selection"; selection: QuerySelection; canonical: string }
	| { kind: "unsupported"; reason: string };

// What is written. A selection is stored as its canonical string and parsed
// again on a hit, which is the check every hand-built URL gets.
type StoredAnswer =
	| { kind: "selection"; canonical: string }
	| { kind: "unsupported"; reason: string };

export async function askCacheKey(
	question: string,
	today: string,
): Promise<string> {
	const request = buildAskInputs(
		askMessages(normalizeText(question), today),
		ASK_REASONING_EFFORT,
		ASK_TEMPERATURE,
	);
	const bytes = new TextEncoder().encode(JSON.stringify([ASK_MODEL, request]));
	return KEY_PREFIX + (await sha256Hex(bytes));
}

export async function readCachedAnswer(
	kv: KVNamespace,
	key: string,
): Promise<CachedAnswer | null> {
	let stored: StoredAnswer | null;
	try {
		stored = await kv.get<StoredAnswer>(key, "json");
	} catch (e) {
		logError("query_ask_cache_read_failed", e);
		return null;
	}
	if (stored?.kind === "unsupported" && typeof stored.reason === "string") {
		return stored;
	}
	if (stored?.kind === "selection" && typeof stored.canonical === "string") {
		const parsed = parseSelection(new URLSearchParams(stored.canonical));
		if (!parsed.ok) return null;
		return {
			kind: "selection",
			selection: parsed.selection,
			canonical: stored.canonical,
		};
	}
	return null;
}

export async function writeCachedAnswer(
	kv: KVNamespace,
	key: string,
	outcome: AskOutcome,
): Promise<void> {
	let stored: StoredAnswer;
	if (outcome.kind === "selection") {
		stored = { kind: "selection", canonical: outcome.canonical };
	} else if (outcome.kind === "unsupported" && outcome.attempts === 1) {
		stored = { kind: "unsupported", reason: outcome.reason };
	} else {
		return;
	}
	try {
		await kv.put(key, JSON.stringify(stored), { expirationTtl: TTL_SECONDS });
	} catch (e) {
		logError("query_ask_cache_write_failed", e);
	}
}
