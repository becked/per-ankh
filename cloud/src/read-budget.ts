// Per-IP read budgets on the public endpoints: the gate a read passes through,
// and the tunable ceiling it measures against.
//
// One gate, several budgets. Which surface gets its own budget, and why they
// are never pooled, is argued in tournament/limits.ts — the 2026-08-05 outage
// wrote that comment. What lives here is the half that is identical whichever
// budget is being spent: the scraper exemption, the untrusted-IP bucket, the
// fire-and-forget audit insert, and the rule that every caller is charged the
// same. Keeping those in one place is what stops four budgets from drifting on
// the parts it took an incident to get right.

import type { EventsEnv } from "./d1";
import {
	countEventsSince,
	isScraperUA,
	type RateLimitedEventType,
} from "./games";
import { logError, logWarn } from "./log";
import { errorResponse, getClientIp } from "./util";

// The event types a read budget may be denominated in: the public reads, and
// only those. Extracted from RateLimitedEventType rather than restated, so a
// rename or removal there is a compile error at the budget that used it.
//
// The whole union is the wrong type here even though every member would
// interpolate into the INSERT safely. A budget declared `eventType: "upload"`
// would count public reads into a mutation's bucket — and the mutation types
// sit in retention.ts's 90-day general_audit bucket rather than the 24h
// rate_limit_counters one, so it would also write an unbounded audit row per
// read. This is the shape the interface had before it was lifted out of
// tournament/public.ts (one shape, three instances); global_stats_view is the
// fourth read to want it.
export type ReadEventType = Extract<
	RateLimitedEventType,
	| "tournament_view"
	| "tournament_list_view"
	| "tournament_link_view"
	| "global_stats_view"
	| "challenge_view"
	| "challenge_link_view"
>;

// A per-IP read budget: which events rows count toward it, and how it answers
// once it's spent.
export interface ReadBudget {
	eventType: ReadEventType;
	message: string;
	code: string;
}

// Per-IP rate limit on a public read. Scraper User-Agents (Discord/Slack/
// Twitter link previews) bypass both the gate and the audit-log insert — they
// fan out load that's not meaningful to count. Applies to everyone else,
// including signed-in users.
//
// Every read is gated and charged, on every caller. There is no cheaper class
// of read and no caller who pays less: a tournament page load costs one slot
// per backend read it makes, whether it was server-rendered or navigated to in
// a hydrated client. The ceilings are set in reads to match — see
// TOURNAMENT_VIEW_PER_HOUR for what that works out to per page.
//
// This was briefly a per-*page-load* charge, where a sub-resource behind
// loadViewableTournament skipped both the gate and the count if the caller
// proved it was our SSR Worker. That saved three to five COUNT(*) per render,
// and cost more than it saved: the same page charged 1 via SSR and 4–6 via a
// hydrated navigation, the ceiling meant reads on one path and page loads on
// the other, and the rate limiter had a branch on who you are. The shared key
// now settles exactly one question — which visitor is this — and nothing about
// what a read costs.
//
// `eventType` is interpolated into the INSERT rather than bound: event_type
// is part of the statement's structure, not a value. RateLimitedEventType is a
// closed literal union, which closes the injection path — same reasoning as
// where it is declared, in games.ts.
export async function enforceReadRateLimit(
	env: EventsEnv,
	request: Request,
	cors: Record<string, string>,
	budget: ReadBudget,
	limit: number,
): Promise<Response | null> {
	const ua = request.headers.get("User-Agent");
	if (isScraperUA(ua)) return null;
	const ip = getClientIp(request) ?? "untrusted";
	const count = await countEventsSince(
		env.EVENTS_DB,
		budget.eventType,
		"ip_address",
		ip,
	);
	if (count >= limit) {
		return errorResponse(budget.message, 429, cors, budget.code);
	}
	env.EVENTS_DB.prepare(
		`INSERT INTO events (event_type, ip_address)
		 VALUES ('${budget.eventType}', ?)`,
	)
		.bind(ip)
		.run()
		.catch((e: unknown) => {
			logError("audit_event_log_failed", e, {
				event_type: budget.eventType,
				ip,
			});
		});
	return null;
}

// A ceiling read off an env var, falling back to the compiled-in default.
// Shared by every read budget so they can't drift in how they parse.
//
// Number(), not parseInt(): parseInt("600 per hour") is 600, which would let a
// mangled value silently pass as a deliberate one. Anything below one whole
// read is treated as unset rather than "refuse everything" — a fat-fingered 0
// during an incident would 429 the whole surface, which is the outage these
// knobs exist to shorten, and so would a slipped decimal point: the gate is
// `count >= limit`, so 0.5 refuses every read after the first exactly as 0
// refuses every read at all. Integers only, for the same reason — a ceiling of
// 1.5 is 2 to the gate and 1.5 to whoever reads it back.
//
// Discarding a value is logged, once per isolate per var. Falling back is the
// safe behaviour, but doing it silently means an operator who mistypes a
// ceiling mid-incident sees the deploy succeed, the traffic unchanged, and no
// reason why — and the value they most plausibly reach for under load, 0, is
// one of the discarded ones. `name` is only carried for this line.
const unparseableLogged = new Set<string>();

export function ceilingFrom(
	raw: string | undefined,
	fallback: number,
	name: string,
): number {
	const parsed = Number(raw);
	if (Number.isInteger(parsed) && parsed >= 1) return parsed;
	if (raw !== undefined && !unparseableLogged.has(name)) {
		unparseableLogged.add(name);
		logWarn("read_ceiling_unparseable", { var: name, value: raw, fallback });
	}
	return fallback;
}
