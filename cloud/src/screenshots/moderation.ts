// Moderation layer 2 (issue #289, step 6): a viewer's report, the admin queue
// it lands in, and the four decisions an admin can take on one screenshot.
//
// Layer 1 is the classifier at upload (clef.ts) and layer 3 is Cloudflare's
// CSAM scanning on the zone. This is the human layer between them, and it
// carries the same weight as the classifier rather than less — the uncertain
// middle band routes straight here, so a row waiting in this queue was never
// published at all.
//
// Separate module from handlers.ts because the audiences are disjoint: nothing
// here is reachable by the person who uploaded the image. The reads and the
// gates there decide what a row may be and who sees it; what is here decides
// what happens to a row after a human looks at it.
//
// THE TWO HIDDEN STATES are what most of this module is shaped by, and
// migration 0051 is where they are written down:
//
//   hidden_at set, hidden_by null   the classifier queued it. The object is
//                                   still in R2, so `approve` can publish it.
//   hidden_by set                   an admin took it down. The object is
//                                   deleted and both its URLs are purged, so
//                                   there is nothing to put back and
//                                   `approve` refuses.
//
// A takedown is therefore not reversible, which is not an oversight: these
// objects are public and edge-cached with no Worker in the image path, so
// clearing a column cannot stop the edge serving bytes it already has.
// Deleting the object is the only thing that does.

import { BANDS, gateVerdict, trippedQuestions } from "./clef";
import { recordScreenshotEvent } from "./handlers";
import {
	removeScreenshot,
	screenshotThumbUrl,
	screenshotUrl,
	type ScreenshotStorageEnv,
} from "./storage";
import { isSiteAdmin, type AdminAuthEnv } from "../admin";
import { countEventsSince } from "../games";
import { displayNameSql } from "../identity";
import { ceilingFrom } from "../read-budget";
import {
	ModerateScreenshotSchema,
	ReportScreenshotSchema,
	type ScreenshotModerationAction,
} from "../schemas/screenshot";
import { sessionFromRequest, type SessionEnv } from "../session";
import type { EventsEnv, QueryableD1 } from "../d1";
import {
	cloudCorsHeaders,
	errorResponse,
	isoInstantSql,
	jsonResponse,
	parseJsonBody,
} from "../util";

export interface ScreenshotModerationEnv
	extends SessionEnv, EventsEnv, AdminAuthEnv, ScreenshotStorageEnv {
	SHARE_DB: QueryableD1;
	ALLOWED_ORIGINS: string;
	PER_USER_SCREENSHOT_REPORTS_PER_HOUR?: string;
}

// ---------- The report budget ----------

// Hourly ceiling on how many reports one account can file. What it bounds is
// the queue, not the endpoint: the composite PK on screenshot_reports already
// holds a reporter to one report per screenshot, so a single account cannot
// inflate the queue by repeating itself — only by working through the corpus,
// which this is what stops.
//
// Counted off the `screenshot_report` events and charged ON SUCCESS, unlike
// the upload attempt counter beside it, which charges before the classifier
// runs. The difference is what the row is: an upload attempt event exists to
// be counted, while a report event is the accountability record of the report
// itself and is KEEP_FOREVER (retention.ts). Writing one per refused attempt
// would fill a table nothing ever prunes with reports that were never filed.
// So what this ceiling bounds is reports that landed — which is the thing an
// admin has to read.
//
// Twenty an hour is well past a person who has noticed something wrong, and a
// reporter who genuinely needs more has the takedown contact in
// AboutDisclaimer as the escalation.
//
// The default only — read the effective ceiling with screenshotReportsPerHour().
export const PER_USER_SCREENSHOT_REPORTS_PER_HOUR = 20;

export function screenshotReportsPerHour(env: ScreenshotModerationEnv): number {
	return ceilingFrom(
		env.PER_USER_SCREENSHOT_REPORTS_PER_HOUR,
		PER_USER_SCREENSHOT_REPORTS_PER_HOUR,
		"PER_USER_SCREENSHOT_REPORTS_PER_HOUR",
	);
}

// ---------- Report ----------

interface ReportTargetRow {
	user_id: string;
}

// POST /v1/games/:id/screenshots/:screenshot_id/report — a signed-in viewer
// reports a screenshot they can see.
//
// Signed-in because `screenshot_reports.reporter_user_id` is NOT NULL: a
// report names who filed it, which is what lets the composite PK hold one
// report per reporter and what makes a pattern of reports legible to an
// admin. An anonymous report would be a row that cannot do either.
//
// Nested under the game like the upload and the owner's delete, because the
// game is what a screenshot belongs to and what its R2 prefix is keyed by.
export async function handleScreenshotReport(
	gameId: string,
	screenshotId: string,
	request: Request,
	env: ScreenshotModerationEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	const userId = session.data.user_id;

	const body = await parseJsonBody(request, ReportScreenshotSchema, cors);
	if (!body.ok) return body.response;

	// `hidden_at IS NULL` is part of the target, not a courtesy: a hidden row
	// is one no reader can see, so a report on one is either a stale client or
	// someone holding the endpoint. 404 covers that alongside "no such
	// screenshot" and "not on that game", the shape the upload and the owner's
	// delete both use — so the message has to be true of all of them.
	const target = await env.SHARE_DB.prepare(
		`SELECT user_id FROM game_screenshots
		 WHERE screenshot_id = ? AND game_id = ? AND hidden_at IS NULL`,
	)
		.bind(screenshotId, gameId)
		.first<ReportTargetRow>();
	if (!target) {
		return errorResponse("That screenshot is gone", 404, cors, "NOT_FOUND");
	}
	if (target.user_id === userId) {
		// The uploader has a delete on their own tile, which is both faster and
		// permanent — a report would route their own image through someone
		// else. The gallery hides the control on an owner's own surface, so
		// this is the API agreeing with the UI rather than a second rule.
		return errorResponse(
			"That's your own screenshot — delete it instead",
			409,
			cors,
			"OWN_SCREENSHOT",
		);
	}

	const filed = await countEventsSince(
		env.EVENTS_DB,
		"screenshot_report",
		"user_id",
		userId,
	);
	if (filed >= screenshotReportsPerHour(env)) {
		return errorResponse(
			"You've reported a lot of screenshots this hour — try again later",
			429,
			cors,
			"RATE_LIMIT_SCREENSHOT_REPORT",
		);
	}

	// One open report per reporter per screenshot (the composite PK from
	// migration 0050). A repeat while the report is still open updates the
	// reason — a reporter who picked the wrong one should be able to correct it
	// — and a repeat after an admin resolved it does nothing: the image has not
	// changed, so re-reporting it is re-litigating a decision, and the WHERE on
	// the upsert is what makes "no appeal path" true in both directions.
	const write = await env.SHARE_DB.prepare(
		`INSERT INTO screenshot_reports (screenshot_id, reporter_user_id, reason)
		 VALUES (?, ?, ?)
		 ON CONFLICT(screenshot_id, reporter_user_id) DO UPDATE SET
		   reason = excluded.reason,
		   created_at = datetime('now')
		 WHERE screenshot_reports.resolved_at IS NULL`,
	)
		.bind(screenshotId, userId, body.body.reason)
		.run();

	// `meta.changes === 0` is the dropped case — the upsert's WHERE refused it,
	// so no report was filed or corrected. Reachable in ordinary use: the
	// control comes back on reload (the lightbox's `reported` set is not
	// persisted), so a reporter whose report was resolved can press it again.
	//
	// Gated here, rather than recorded regardless, because this row is what
	// this ceiling bounds and it is KEEP_FOREVER — a row per attempt that
	// landed nowhere would accumulate in a list nothing prunes, and would read
	// as a report that was never filed. It is also what charges the reporter's
	// hourly budget (countEventsSince above reads these rows), so the two
	// follow one decision. What the reporter is told does not change either
	// way.
	if (write.meta.changes > 0) {
		await recordScreenshotEvent(env, "screenshot_report", userId, request, {
			screenshot_id: screenshotId,
			game_id: gameId,
			reason: body.body.reason,
		});
	}

	// The same answer either way, deliberately: whether a report was recorded,
	// updated or dropped as already-resolved is the queue's business, and a
	// reporter who could tell them apart could read an admin's decision off
	// the response.
	return jsonResponse({ ok: true }, 200, cors);
}

// ---------- The admin queue ----------

// One row of either list. The Clef probabilities ride along because they are
// what makes the queue sortable and what says which question tripped — that is
// the reason migration 0050 stores them — and the identity columns are joined
// live rather than snapshotted, the stance featured.ts takes for the same
// reason: a rename should be reflected here too.
interface ModerationRow {
	screenshot_id: string;
	game_id: string;
	r2_key: string;
	width: number;
	height: number;
	caption: string | null;
	// An ISO instant, not the column's own text — MODERATION_COLUMNS projects
	// it through isoInstantSql, because the card renders it as a date and
	// `datetime('now')` text parses as LOCAL time in a browser. The galleries'
	// rows carry the same shape for the same reason (handlers.ts).
	created_at: string;
	hidden_at: string | null;
	hidden_by: string | null;
	// Raw, and the only timestamp here that is: the card reads it as
	// starred-or-not and never prints it. Project it like created_at above if
	// a surface ever states when a star was given.
	featured_at: string | null;
	is_old_world: number;
	contains_nsfw: number;
	contains_gore: number;
	is_a_photograph: number;
	game_screenshot_confidence: number;
	user_id: string;
	uploader_name: string | null;
	uploader_slug: string | null;
	game_name: string | null;
	game_display_name: string | null;
	user_nation: string | null;
	total_turns: number | null;
}

interface ReportRow {
	screenshot_id: string;
	reason: string;
	// An ISO instant, like the row's own created_at above — the card prints
	// this one too, beside the reporter.
	created_at: string;
	reporter_user_id: string;
	reporter_name: string | null;
	reporter_slug: string | null;
}

// Every column either list needs, from one place — the two differ only in
// which rows they keep and in what order, so a column added for one is
// present on both by construction.
const MODERATION_COLUMNS = `
	s.screenshot_id, s.game_id, s.r2_key, s.width, s.height, s.caption,
	${isoInstantSql("s.created_at")} AS created_at,
	s.hidden_at, s.hidden_by, s.featured_at,
	s.is_old_world, s.contains_nsfw, s.contains_gore, s.is_a_photograph,
	s.game_screenshot_confidence,
	s.user_id, ${displayNameSql("u")} AS uploader_name, u.slug AS uploader_slug,
	g.game_name, g.display_name AS game_display_name, g.user_nation,
	g.total_turns`;

const MODERATION_FROM = `
	FROM game_screenshots s
	JOIN users u ON u.user_id = s.user_id
	JOIN games g ON g.game_id = s.game_id`;

// A screenshot's state, as the queue has to reason about it. Derived from the
// two columns rather than stored, so there is one definition of "hidden by an
// admin" and it is the one migration 0051 documents.
function statusOf(row: ModerationRow): "published" | "in_review" | "hidden" {
	if (row.hidden_by != null) return "hidden";
	return row.hidden_at == null ? "published" : "in_review";
}

function serializeModerationRow(
	env: ScreenshotModerationEnv,
	row: ModerationRow,
	reports: ReportRow[],
) {
	const nouls = {
		is_old_world: row.is_old_world,
		contains_nsfw: row.contains_nsfw,
		contains_gore: row.contains_gore,
		is_a_photograph: row.is_a_photograph,
	};
	// Re-derived from the stored probabilities against the bands as they stand
	// now, which is the only form in which "which question tripped" survives:
	// the row stores the numbers, not the verdict, precisely so the question
	// can be named again after a band moves.
	const verdict = gateVerdict(nouls, BANDS);
	return {
		screenshot_id: row.screenshot_id,
		game_id: row.game_id,
		url: screenshotUrl(env, row.r2_key),
		thumb_url: screenshotThumbUrl(env, row.r2_key),
		width: row.width,
		height: row.height,
		caption: row.caption,
		created_at: row.created_at,
		status: statusOf(row),
		featured_at: row.featured_at,
		uploader: {
			user_id: row.user_id,
			display_name: row.uploader_name,
			slug: row.uploader_slug,
		},
		// The raw title fields, formatted client-side by formatGameTitle — the
		// shape the profile gallery read already travels in.
		game: {
			game_name: row.game_name,
			display_name: row.game_display_name,
			user_nation: row.user_nation,
			total_turns: row.total_turns,
		},
		clef: {
			...nouls,
			game_screenshot_confidence: row.game_screenshot_confidence,
			// Empty on a row the current bands would accept, which is itself
			// worth seeing: it means the band that queued this row has since
			// moved.
			tripped: trippedQuestions(nouls, BANDS, verdict),
		},
		reports: reports.map((r) => ({
			reason: r.reason,
			created_at: r.created_at,
			reporter: {
				user_id: r.reporter_user_id,
				display_name: r.reporter_name,
				slug: r.reporter_slug,
			},
		})),
	};
}

// GET /v1/admin/screenshots — the moderation tab's whole payload.
//
// Two lists rather than one, because they are two jobs in two orders. The
// queue is what needs a decision, oldest first — a queue is served in the
// order it arrived, which is also what idx_screenshot_reports_open is sorted
// for. The featured list is the home strip's inventory, newest first, so a
// star can be taken back.
//
// A published screenshot with an open report appears in both, which is
// accurate: it needs a decision AND it is on the home page. Nothing else
// overlaps, because a hidden row cannot be starred.
//
// Uncapped, like the featured-videos list it sits beside: the 5-per-game cap
// bounds the table at ~5k rows and both legs here are small slices of it. No
// read budget either — the gate is isSiteAdmin, and there is exactly one.
export async function handleAdminListScreenshots(
	request: Request,
	env: ScreenshotModerationEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!(await isSiteAdmin(env, session))) {
		return errorResponse("Not found", 404, cors, "NOT_FOUND");
	}

	// The queue's two legs: what the classifier could not decide, and what a
	// viewer has objected to. A taken-down row is in neither — a takedown
	// resolves the reports that prompted it, so a closed decision does not
	// come back asking to be made again.
	const queued = await env.SHARE_DB.prepare(
		`SELECT ${MODERATION_COLUMNS} ${MODERATION_FROM}
		 WHERE (s.hidden_at IS NOT NULL AND s.hidden_by IS NULL)
		    OR EXISTS (SELECT 1 FROM screenshot_reports r
		               WHERE r.screenshot_id = s.screenshot_id
		                 AND r.resolved_at IS NULL)
		 ORDER BY s.created_at ASC, s.rowid ASC`,
	).all<ModerationRow>();

	const featured = await env.SHARE_DB.prepare(
		`SELECT ${MODERATION_COLUMNS} ${MODERATION_FROM}
		 WHERE s.featured_at IS NOT NULL
		 ORDER BY s.featured_at DESC, s.rowid DESC`,
	).all<ModerationRow>();

	// Every open report, in one read rather than one per row. Open reports
	// only ever sit on rows the queue above already selected, so there is no
	// id list to thread through and nothing to narrow it by.
	const reports = await env.SHARE_DB.prepare(
		`SELECT r.screenshot_id, r.reason,
		        ${isoInstantSql("r.created_at")} AS created_at, r.reporter_user_id,
		        ${displayNameSql("u")} AS reporter_name, u.slug AS reporter_slug
		 FROM screenshot_reports r
		 JOIN users u ON u.user_id = r.reporter_user_id
		 WHERE r.resolved_at IS NULL
		 ORDER BY r.created_at ASC`,
	).all<ReportRow>();

	const byScreenshot = new Map<string, ReportRow[]>();
	for (const report of reports.results ?? []) {
		const list = byScreenshot.get(report.screenshot_id);
		if (list) list.push(report);
		else byScreenshot.set(report.screenshot_id, [report]);
	}

	const serialize = (row: ModerationRow) =>
		serializeModerationRow(env, row, byScreenshot.get(row.screenshot_id) ?? []);

	return jsonResponse(
		{
			queue: (queued.results ?? []).map(serialize),
			featured: (featured.results ?? []).map(serialize),
		},
		200,
		cors,
	);
}

// ---------- The admin decision ----------

interface ModerationTargetRow {
	game_id: string;
	r2_key: string;
	hidden_at: string | null;
	hidden_by: string | null;
}

// Mark every open report on one screenshot as looked at. Shared by `takedown`
// and `resolve_reports` because they are the same bookkeeping under two
// decisions: either way a human has read the report and acted on it, and
// either way the row must stop appearing in the queue.
async function resolveOpenReports(
	env: ScreenshotModerationEnv,
	screenshotId: string,
	adminUserId: string,
): Promise<void> {
	await env.SHARE_DB.prepare(
		`UPDATE screenshot_reports
		    SET resolved_at = datetime('now'), resolved_by = ?
		  WHERE screenshot_id = ? AND resolved_at IS NULL`,
	)
		.bind(adminUserId, screenshotId)
		.run();
}

// POST /v1/admin/screenshots/:screenshot_id/moderate — one decision, named in
// the body (ModerateScreenshotSchema lists them).
//
// One route for the five rather than five routes, because they are one
// decision about one row and two of them are not independent: a takedown
// clears the star and resolves the reports, so the combinations that would
// need refusing on separate endpoints don't exist here. The audit row carries
// which action it was.
//
// Not nested under the game, unlike the owner's delete: an admin reaches a
// screenshot from the queue, which spans every game, and `screenshot_id` is a
// primary key — requiring the game id would be a second value the caller has
// to carry for no authorization it could add.
export async function handleScreenshotModerate(
	screenshotId: string,
	request: Request,
	env: ScreenshotModerationEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	// The `!session` leg is redundant against isSiteAdmin, which returns false
	// without one, and carries its weight by narrowing the session for the
	// hidden_by / featured_by / resolved_by writes below.
	if (!session || !(await isSiteAdmin(env, session))) {
		return errorResponse("Not found", 404, cors, "NOT_FOUND");
	}
	const adminUserId = session.data.user_id;

	const body = await parseJsonBody(request, ModerateScreenshotSchema, cors);
	if (!body.ok) return body.response;
	const action: ScreenshotModerationAction = body.body.action;

	const row = await env.SHARE_DB.prepare(
		`SELECT game_id, r2_key, hidden_at, hidden_by
		 FROM game_screenshots WHERE screenshot_id = ?`,
	)
		.bind(screenshotId)
		.first<ModerationTargetRow>();
	if (!row) {
		return errorResponse("That screenshot is gone", 404, cors, "NOT_FOUND");
	}

	switch (action) {
		case "takedown": {
			// COALESCE on both, the acceptance timestamp's shape, and it does
			// two jobs. `hidden_at` means "invisible since", so a row the
			// classifier already queued keeps the moment it stopped being
			// visible rather than being moved to the moment someone confirmed
			// it — the decision's own time is on the audit event. And neither
			// column is rewritten by a repeated takedown, so the first admin
			// to act stays the one recorded.
			//
			// The star goes with it. A hidden row has no object, so a starred
			// one would be a home-strip entry that can only render broken, and
			// the takedown is the decision that reverses the curation.
			await env.SHARE_DB.prepare(
				`UPDATE game_screenshots
				    SET hidden_at = COALESCE(hidden_at, datetime('now')),
				        hidden_by = COALESCE(hidden_by, ?),
				        featured_at = NULL,
				        featured_by = NULL
				  WHERE screenshot_id = ?`,
			)
				.bind(adminUserId, screenshotId)
				.run();
			// D1 first, then the object and both cached URLs — the order the
			// owner's delete takes, and for the same reason: the row is what a
			// reader consults, so an object that outlived its row renders
			// nowhere while a row that outlived its object renders a broken
			// tile. Re-run on a repeated takedown rather than short-circuited:
			// the purge logs its failures instead of throwing, so taking the row
			// down again is the only recovery path a half-failed purge has.
			await removeScreenshot(env, row.r2_key, screenshotId);
			await resolveOpenReports(env, screenshotId, adminUserId);
			break;
		}
		case "approve": {
			if (row.hidden_by != null) {
				// The bytes are gone. Clearing the column would publish a row
				// whose tile and lightbox both 404, which is worse than the
				// refusal — and there is nothing to re-upload from, since the
				// object was deleted and purged.
				return errorResponse(
					"That screenshot was taken down, which deleted the image — it can't be restored",
					409,
					cors,
					"OBJECT_REMOVED",
				);
			}
			await env.SHARE_DB.prepare(
				`UPDATE game_screenshots SET hidden_at = NULL
				  WHERE screenshot_id = ? AND hidden_by IS NULL`,
			)
				.bind(screenshotId)
				.run();
			break;
		}
		case "star": {
			if (row.hidden_at != null) {
				return errorResponse(
					"A hidden screenshot can't be starred",
					409,
					cors,
					"SCREENSHOT_HIDDEN",
				);
			}
			// COALESCE on both, so re-starring an already-starred screenshot
			// keeps the timestamp the home strip orders by instead of jumping
			// it to the front of its own strip.
			//
			// `AND hidden_at IS NULL` is the pre-check above held at write
			// time, the way `approve` holds its own: a takedown landing between
			// the SELECT and this statement would otherwise leave a starred row
			// with no object. The home strip filters `hidden_at` itself, but
			// the admin tab's featured list does not, so such a row would sit
			// there offering Unstar.
			await env.SHARE_DB.prepare(
				`UPDATE game_screenshots
				    SET featured_at = COALESCE(featured_at, datetime('now')),
				        featured_by = COALESCE(featured_by, ?)
				  WHERE screenshot_id = ? AND hidden_at IS NULL`,
			)
				.bind(adminUserId, screenshotId)
				.run();
			break;
		}
		case "unstar": {
			await env.SHARE_DB.prepare(
				`UPDATE game_screenshots SET featured_at = NULL, featured_by = NULL
				  WHERE screenshot_id = ?`,
			)
				.bind(screenshotId)
				.run();
			break;
		}
		case "resolve_reports": {
			// The reports were read and the image stays up. No appeal path
			// cuts both ways: the same reporter cannot re-open this (the
			// upsert's WHERE above), and nothing tells them it was dismissed.
			await resolveOpenReports(env, screenshotId, adminUserId);
			break;
		}
	}

	await recordScreenshotEvent(
		env,
		"screenshot_moderate",
		adminUserId,
		request,
		{ screenshot_id: screenshotId, game_id: row.game_id, action },
	);

	return jsonResponse({ ok: true }, 200, cors);
}
