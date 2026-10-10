// User-uploaded game screenshots: the upload gate and the terms acceptance it
// refuses without (issue #289, step 3), the two public reads the galleries
// render from, and the owner's delete (step 5).
//
// One module because they are one resource: the gates below decide what a row
// may be, the reads decide which rows a viewer sees, and all three build their
// URLs from the same place. Splitting them would mean two environments and two
// serializers over one table.
//
// Nothing is stored until it has been screened, so the order here is
// load-bearing. Cheapest certain reject first — terms, then ownership and
// visibility, then the two caps, then the rate limit — because every one of
// those is a D1 read against a Clef call that costs money and a Workers AI
// neuron allocation. Then the free pre-filter, then the classifier, then R2,
// then D1.
//
// The gate FAILS CLOSED. A classifier error refuses the upload: Clef returns
// a probability for anything rather than declining, so a gate that fell open
// on an error would be a gate only while the model was up.

import { nanoid } from "nanoid";
import * as v from "valibot";

import {
	BANDS,
	buildClefRequest,
	CLEF_MAX_IMAGE_BYTES,
	CLEF_MAX_DECODED_BYTES,
	CLEF_MODEL,
	gateVerdict,
	readClefAnswers,
	trippedQuestions,
	type ClefAnswers,
} from "./clef";
import {
	deleteScreenshotObject,
	removeScreenshot,
	screenshotKey,
	screenshotThumbUrl,
	screenshotUrl,
	type ScreenshotStorageEnv,
} from "./storage";
import { readWebpSize } from "./webp";
import { countEventsSince, isBlobLike } from "../games";
import { beginR2Op, logError, setLogField, setSecurityReason } from "../log";
import {
	ceilingFrom,
	enforceReadRateLimit,
	type ReadBudget,
} from "../read-budget";
import {
	AcceptScreenshotTermsSchema,
	ScreenshotCaptionSchema,
} from "../schemas/screenshot";
import { sessionFromRequest, type SessionEnv } from "../session";
import type { EventsEnv, QueryableD1 } from "../d1";
import { MIN_LONG_EDGE } from "../../../src/lib/screenshots/stored-variant";
import {
	base64Encode,
	cloudCorsHeaders,
	errorResponse,
	getClientIp,
	jsonResponse,
	parseJsonBody,
} from "../util";

export interface ScreenshotsEnv
	extends SessionEnv, EventsEnv, ScreenshotStorageEnv {
	SHARE_DB: QueryableD1;
	// Workers AI, for the one Clef call. The binding is the whole access path:
	// remote image URLs are not accepted, so the bytes travel in the call.
	AI: Ai;
	ALLOWED_ORIGINS: string;
	PER_USER_SCREENSHOTS_PER_HOUR?: string;
	SCREENSHOT_VIEW_PER_HOUR?: string;
}

// ---------- Caps ----------

// Five per game is what lets the game-detail strip read as one row at every
// width; the account number bounds storage and moderation attention.
//
// Both are enforced structurally, in the INSERT, rather than by the
// read-then-insert the gates below do: a separate COUNT(*) guard races two
// concurrent uploads past the cap, where `INSERT ... SELECT ... WHERE (SELECT
// COUNT(*) ...) < n` is one atomic decision in SQLite. The gates are still
// worth their reads — they refuse before the Clef call, so a user at their cap
// gets a clear answer instead of an inference bill.
export const MAX_SCREENSHOTS_PER_GAME = 5;
export const MAX_SCREENSHOTS_PER_ACCOUNT = 100;

// The hourly ceiling on upload ATTEMPTS, which is a different job from the
// caps above: the caps bound what is stored, this bounds what is classified.
// A refused upload spends a Clef call and no quota, so the caps bound an
// attacker's storage and only this bounds their inference spend — which is
// why the counter counts attempts rather than stored screenshots.
//
// Tighter than PER_USER_UPLOADS_PER_HOUR (100), because the two have opposite
// shapes: saves get bulk-reuploaded whenever PARSER_VERSION moves, screenshots
// never do. Twenty is four games' worth of strip in an hour, well past human
// use, and bounds a single account at ~$0.008 of classification an hour.
//
// The default only — read the effective ceiling with screenshotsPerHour().
export const PER_USER_SCREENSHOTS_PER_HOUR = 20;

export function screenshotsPerHour(env: ScreenshotsEnv): number {
	return ceilingFrom(
		env.PER_USER_SCREENSHOTS_PER_HOUR,
		PER_USER_SCREENSHOTS_PER_HOUR,
		"PER_USER_SCREENSHOTS_PER_HOUR",
	);
}

// ---------- The read budget ----------

// Per-IP hourly ceiling on the two gallery reads, and its own budget rather
// than a share of anon_read: the game strip is one read per /games/[id]
// render, so on the shared budget a crawl of game pages would decide when the
// profile tab starts refusing — and anon_read is already the tightest ceiling
// the pages that spend it meet (the tournament_link_view argument, for the
// same incident).
//
// ONE budget for both reads, where the challenge and tournament link reads
// each took their own. The split there was between surfaces with different
// fan-out — a link read on every game render against the pages it would have
// drained. These two have the same shape as each other: one read per view of
// one gallery, by the same visitor, so a crawl of either spends at the same
// rate and there is nothing for the second budget to protect.
//
// Above ANON_READS_PER_HOUR, so it is never the limit a real visitor meets
// first; when it does fire, the gallery renders empty rather than failing the
// page it is on.
//
// The default only — read the effective ceiling with screenshotViewPerHour().
export const SCREENSHOT_VIEW_PER_HOUR = 600;

export function screenshotViewPerHour(env: ScreenshotsEnv): number {
	return ceilingFrom(
		env.SCREENSHOT_VIEW_PER_HOUR,
		SCREENSHOT_VIEW_PER_HOUR,
		"SCREENSHOT_VIEW_PER_HOUR",
	);
}

const VIEW_BUDGET: ReadBudget = {
	eventType: "screenshot_view",
	message: "Screenshot view rate limit exceeded",
	code: "RATE_LIMIT_SCREENSHOT_VIEW",
};

// ---------- The free pre-filter ----------

// A quality floor for the strip tile and the thumbnail, not a guess at what
// the image is, and the only free check that survives: the client re-encode
// strips EXIF and flattens animation, so a camera photo arrives with no
// Make/Model to find and an animated input arrives as one frame.
// is_a_photograph carries the camera case instead.
//
// Deliberately NO aspect-ratio band. A crop IS the typical upload —
// highlighting one city's layout or a leader's stats is why someone saves a
// screenshot at all — so shape carries no signal about whether an image
// contains the game, and a ~1.2-2.5 band refused 5 of the 12 real images the
// corpus started from while a landscape camera photo at 4:3 sat comfortably
// inside it.
//
// The number is imported rather than written here because the browser applies
// the same floor to the same bytes before spending an upload on them, and the
// eval excludes the images it refuses from every band — three readings of one
// threshold (stored-variant.ts). This is still the only one that enforces it.

// The ceiling is on PIXELS, not on the long edge: Clef's binding limit is
// 8 MiB decoded, and decoded RGBA bites on non-16:9 shapes (1920x1200 on a
// 16:10 display is 8.79 MiB and over). The client resizes to 1600 px / ~1.8 MP
// before upload, so this sits above that — derived from the decode budget
// rather than set to the client's target, so the client's own rounding cannot
// trip a limit meant for a hand-crafted request. Clef resizes to ~1 MP
// internally for tokenization, so the pixels either side of the client's
// target buy no classifier detail and the bands transfer regardless.
const MAX_PIXELS = Math.floor(CLEF_MAX_DECODED_BYTES / 4);

// ---------- Upload ----------

interface TermsRow {
	screenshot_terms_accepted_at: string | null;
}
interface GameOwnerRow {
	user_id: string;
	is_public: number;
}
interface CountRow {
	count: number;
}
interface InsertedRow {
	created_at: string;
	hidden_at: string | null;
}

// POST /v1/games/:id/screenshots — multipart: an `image` part carrying the
// WebP the browser re-encoded, and an optional `caption` field.
export async function handleScreenshotUpload(
	gameId: string,
	request: Request,
	env: ScreenshotsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	const userId = session.data.user_id;

	// Gate 1 — the terms. The error code is what the UI turns into the terms
	// prompt, so it has to be distinguishable from every other refusal.
	const terms = await env.SHARE_DB.prepare(
		"SELECT screenshot_terms_accepted_at FROM users WHERE user_id = ?",
	)
		.bind(userId)
		.first<TermsRow>();
	if (!terms || terms.screenshot_terms_accepted_at == null) {
		// The security tee classifies by status, so this 403 would otherwise
		// be teed to Skiff as `auth_fail` — a false positive by construction,
		// since it is the designed first step of the upload flow rather than
		// anything going wrong, and one that fires on every account's first
		// screenshot. resolveSecurityEvent honours a handler-set reason ahead
		// of status (which is why `signup` is in the vocabulary), so the row
		// is still emitted and is simply labelled truthfully.
		setSecurityReason("terms_gate");
		return errorResponse(
			"Accept the screenshot terms before uploading",
			403,
			cors,
			"TERMS_NOT_ACCEPTED",
		);
	}

	// Gate 2 — the game is this user's, and public. A screenshot requires a
	// public game: that is what lets every stored object be served from a
	// cacheable public host with no per-request gate, so it is a precondition
	// of storing anything, not a display rule.
	const game = await env.SHARE_DB.prepare(
		"SELECT user_id, is_public FROM games WHERE game_id = ?",
	)
		.bind(gameId)
		.first<GameOwnerRow>();
	// Don't leak existence: 404 covers both "no game" and "not yours", the
	// shape handleGamePatch uses — so the message has to be true of either.
	//
	// Written for the uploader, like every message below it: the picker shows
	// `error` verbatim rather than restating the rule in a second place, so
	// each of these is the copy a person reads. The remaining ones in this
	// handler (INVALID_FORM, MISSING_IMAGE, EMPTY_IMAGE, INVALID_IMAGE) stay
	// API-shaped on purpose — a client that re-encodes before posting cannot
	// reach them, so they are for whoever is holding the endpoint wrong.
	if (!game || game.user_id !== userId) {
		return errorResponse(
			"That game is gone, or it isn't yours",
			404,
			cors,
			"NOT_FOUND",
		);
	}
	if (game.is_public !== 1) {
		return errorResponse(
			"Make the game public before adding screenshots",
			409,
			cors,
			"GAME_NOT_PUBLIC",
		);
	}

	// Gate 3 — the per-game cap.
	const perGame = await env.SHARE_DB.prepare(
		"SELECT COUNT(*) AS count FROM game_screenshots WHERE game_id = ?",
	)
		.bind(gameId)
		.first<CountRow>();
	if ((perGame?.count ?? 0) >= MAX_SCREENSHOTS_PER_GAME) {
		return errorResponse(
			`This game already has ${MAX_SCREENSHOTS_PER_GAME} screenshots`,
			409,
			cors,
			"GAME_SCREENSHOT_LIMIT",
		);
	}

	// Gate 4 — the per-account cap.
	const perAccount = await env.SHARE_DB.prepare(
		"SELECT COUNT(*) AS count FROM game_screenshots WHERE user_id = ?",
	)
		.bind(userId)
		.first<CountRow>();
	if ((perAccount?.count ?? 0) >= MAX_SCREENSHOTS_PER_ACCOUNT) {
		return errorResponse(
			`Your account is at its limit of ${MAX_SCREENSHOTS_PER_ACCOUNT} screenshots`,
			409,
			cors,
			"ACCOUNT_SCREENSHOT_LIMIT",
		);
	}

	// Gate 5 — the hourly attempt budget, counted and then charged. Charged
	// here rather than on success, because it is the refused uploads that need
	// bounding (the slug_claim_attempt shape, retention.ts).
	const attempts = await countEventsSince(
		env.EVENTS_DB,
		"screenshot_upload_attempt",
		"user_id",
		userId,
	);
	if (attempts >= screenshotsPerHour(env)) {
		return errorResponse(
			"You've uploaded a lot of screenshots this hour — try again later",
			429,
			cors,
			"RATE_LIMIT_SCREENSHOT_UPLOAD",
		);
	}
	await recordEvent(env, "screenshot_upload_attempt", userId, request, null);

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return errorResponse("Invalid multipart body", 400, cors, "INVALID_FORM");
	}
	const imagePart = form.get("image");
	if (!isBlobLike(imagePart)) {
		return errorResponse("Missing 'image' part", 400, cors, "MISSING_IMAGE");
	}
	if (imagePart.size === 0) {
		return errorResponse("Empty image", 400, cors, "EMPTY_IMAGE");
	}
	if (imagePart.size > CLEF_MAX_IMAGE_BYTES) {
		return errorResponse("Image too large", 413, cors, "IMAGE_TOO_LARGE");
	}
	const captionRaw = form.get("caption");
	let caption: string | null = null;
	if (typeof captionRaw === "string") {
		const parsed = v.safeParse(ScreenshotCaptionSchema, captionRaw);
		if (!parsed.success) {
			return errorResponse(
				parsed.issues[0]?.message ?? "Invalid caption",
				400,
				cors,
				"INVALID_CAPTION",
			);
		}
		caption = parsed.output === "" ? null : parsed.output;
	}

	// The bytes, once. Everything downstream — the dimensions, the classifier
	// verdict, the stored object — is this same buffer, so the verdict binds
	// what R2 holds rather than a separate copy of it.
	const bytes = new Uint8Array(await imagePart.arrayBuffer());
	const size = readWebpSize(bytes);
	if (!size) {
		return errorResponse("Image must be a WebP", 400, cors, "INVALID_IMAGE");
	}
	if (Math.max(size.width, size.height) < MIN_LONG_EDGE) {
		return errorResponse(
			`Screenshots must be at least ${MIN_LONG_EDGE} px on the long edge`,
			400,
			cors,
			"IMAGE_TOO_SMALL",
		);
	}
	if (size.width * size.height > MAX_PIXELS) {
		return errorResponse("Image too large", 413, cors, "IMAGE_TOO_LARGE");
	}

	let answers: ClefAnswers;
	try {
		answers = readClefAnswers(
			await env.AI.run(CLEF_MODEL, buildClefRequest(base64Encode(bytes))),
		);
	} catch (e) {
		// Fail closed, loudly. A gate that fails open is not a gate, and the
		// human queue carries the same weight as the classifier rather than
		// less, so there is nowhere to route an unclassified image.
		logError("screenshot_classify_failed", e, { game_id: gameId });
		return errorResponse(
			"Screenshot screening is unavailable — try again later",
			503,
			cors,
			"CLASSIFIER_UNAVAILABLE",
		);
	}
	const verdict = gateVerdict(answers.nouls, BANDS);
	const tripped = trippedQuestions(answers.nouls, BANDS, verdict);
	setLogField("screenshot_verdict", verdict);
	setLogField("clef_input_tokens", answers.inputTokens);
	if (tripped.length > 0) setLogField("screenshot_tripped", tripped.join(","));

	if (verdict === "reject") {
		// One message for both reject-capable bands, and true of either: a
		// photograph is not an Old World screenshot any more than a low
		// is_old_world is. The two safety questions have a review floor and no
		// ceiling, so they never land here — give one a reject bound and this
		// copy stops being accurate. `questions` carries which one it was.
		return errorResponse(
			"That image doesn't look like an Old World screenshot",
			422,
			cors,
			"SCREENSHOT_REJECTED",
			{ questions: tripped },
		);
	}

	const screenshotId = nanoid(21);
	const r2Key = screenshotKey(gameId, screenshotId);

	const endPut = beginR2Op();
	try {
		// Only the content type. The zone's Cache Rule sets Edge and Browser
		// TTL for this hostname and ignores cache-control by design, so an
		// httpMetadata.cacheControl here would be a second copy of those
		// numbers that nothing reads.
		await env.SCREENSHOT_BUCKET.put(r2Key, bytes, {
			httpMetadata: { contentType: "image/webp" },
		});
	} catch (e) {
		logError("r2_put_failed", e, { screenshot_id: screenshotId });
		return errorResponse(
			"Couldn't store that screenshot — try again",
			500,
			cors,
			"R2_FAILED",
		);
	} finally {
		endPut();
	}

	// Both caps are in the statement. `hidden_at` is written by SQLite rather
	// than bound, so a queued row carries the same datetime('now') format as
	// every other timestamp in the schema — a mixed format in one column
	// would break ordering on it.
	let inserted: InsertedRow | null = null;
	try {
		inserted = await env.SHARE_DB.prepare(
			`INSERT INTO game_screenshots
			   (screenshot_id, game_id, user_id, r2_key, width, height, size_bytes,
			    caption, is_old_world, contains_nsfw, contains_gore,
			    is_a_photograph, game_screenshot_confidence,
			    game_screenshot_probabilities, hidden_at)
			 SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
			        CASE WHEN ? = 1 THEN datetime('now') END
			 WHERE (SELECT COUNT(*) FROM game_screenshots WHERE game_id = ?) < ?
			   AND (SELECT COUNT(*) FROM game_screenshots WHERE user_id = ?) < ?
			 RETURNING created_at, hidden_at`,
		)
			.bind(
				screenshotId,
				gameId,
				userId,
				r2Key,
				size.width,
				size.height,
				bytes.byteLength,
				caption,
				answers.nouls.is_old_world,
				answers.nouls.contains_nsfw,
				answers.nouls.contains_gore,
				answers.nouls.is_a_photograph,
				answers.score,
				JSON.stringify(answers.probabilities),
				verdict === "review" ? 1 : 0,
				gameId,
				MAX_SCREENSHOTS_PER_GAME,
				userId,
				MAX_SCREENSHOTS_PER_ACCOUNT,
			)
			.first<InsertedRow>();
	} catch (e) {
		logError("d1_insert_failed", e, { screenshot_id: screenshotId });
		await deleteScreenshotObject(env, r2Key, screenshotId);
		return errorResponse(
			"Couldn't save that screenshot — try again",
			500,
			cors,
			"D1_FAILED",
		);
	}
	if (!inserted) {
		// The statement's own cap guard refused it — a concurrent upload took
		// the last slot between gate 3/4 and here. The object is already in
		// R2, so it goes back out.
		await deleteScreenshotObject(env, r2Key, screenshotId);
		return errorResponse(
			"Screenshot limit reached",
			409,
			cors,
			"GAME_SCREENSHOT_LIMIT",
		);
	}

	await recordEvent(env, "screenshot_upload", userId, request, {
		screenshot_id: screenshotId,
		game_id: gameId,
		verdict,
		size_bytes: bytes.byteLength,
	});

	return jsonResponse(
		{
			screenshot: {
				screenshot_id: screenshotId,
				game_id: gameId,
				url: screenshotUrl(env, r2Key),
				// Both URLs, so an accepted upload can become a strip tile
				// without a round trip — and so the client never derives an
				// image URL of its own (the thumbnail's options are what the
				// purge has to match).
				thumb_url: screenshotThumbUrl(env, r2Key),
				width: size.width,
				height: size.height,
				size_bytes: bytes.byteLength,
				caption,
				// A review-band upload is stored hidden, with its object in
				// R2, until an admin decides — so the uploader is told it is
				// queued rather than shown a tile no reader will render.
				status: inserted.hidden_at == null ? "published" : "in_review",
				created_at: inserted.created_at,
			},
		},
		201,
		cors,
	);
}

// ---------- Reads ----------

// One stored screenshot, as both galleries render it. `hidden_at` is the only
// filter either read applies — a screenshot requires a public game, enforced
// at the upload endpoint and again by handleGamePatch's HAS_SCREENSHOTS
// refusal, so there is no is_public join on this table and nothing downstream
// should add one (migration 0050 says so at the top).
//
// Both URLs are built here rather than derived by the client, because the
// thumbnail's transformation options are also what the purge has to name: a
// client that assembled its own tile URL would be a second copy of them, and
// the symptom of a disagreement would be a deleted image that keeps serving.
interface ScreenshotRow {
	screenshot_id: string;
	game_id: string;
	r2_key: string;
	width: number;
	height: number;
	caption: string | null;
}

// The game columns the profile tab needs to name and link the game a shot
// belongs to. The title itself is derived client-side by formatGameTitle,
// which is where every other surface derives it — so the raw fields travel,
// the way GET /v1/games does for the list.
interface ScreenshotGameRow extends ScreenshotRow {
	game_name: string | null;
	display_name: string | null;
	user_nation: string | null;
	total_turns: number | null;
}

function serializeScreenshot(env: ScreenshotsEnv, row: ScreenshotRow) {
	return {
		screenshot_id: row.screenshot_id,
		game_id: row.game_id,
		url: screenshotUrl(env, row.r2_key),
		thumb_url: screenshotThumbUrl(env, row.r2_key),
		width: row.width,
		height: row.height,
		caption: row.caption,
	};
}

// GET /v1/games/:id/screenshots — one game's strip, newest first. Public.
//
// No LIMIT: the 5-per-game cap bounds this to five rows, and a second number
// here would be a display cap that could disagree with the storage one.
export async function handleGameScreenshots(
	gameId: string,
	request: Request,
	env: ScreenshotsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const rl = await enforceReadRateLimit(
		env,
		request,
		cors,
		VIEW_BUDGET,
		screenshotViewPerHour(env),
	);
	if (rl) return rl;

	// rowid breaks the tie, not screenshot_id: created_at is
	// datetime('now') at one-second resolution, so two uploads in the same
	// second order arbitrarily on created_at alone, and a nanoid tiebreak
	// would be stable but random. rowid is insertion order, which is what
	// "newest first" means. The sort is over at most five rows.
	const rows = await env.SHARE_DB.prepare(
		`SELECT screenshot_id, game_id, r2_key, width, height, caption
		 FROM game_screenshots
		 WHERE game_id = ? AND hidden_at IS NULL
		 ORDER BY created_at DESC, rowid DESC`,
	)
		.bind(gameId)
		.all<ScreenshotRow>();

	return jsonResponse(
		{
			screenshots: (rows.results ?? []).map((r) => serializeScreenshot(env, r)),
		},
		200,
		cors,
	);
}

// GET /v1/users/:user_id/screenshots — one uploader's shots across all their
// games, newest first. Public, and the profile Screenshots tab's lazy payload.
//
// No LIMIT here either, for the same reason: the 100-per-account cap bounds
// it. `user_id` is carried on the row rather than joined from the game (the
// uploader is always the game's owner — the upload gate requires it), so this
// is one index-backed read on idx_game_screenshots_user plus the title join.
export async function handleUserScreenshots(
	userId: string,
	request: Request,
	env: ScreenshotsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const rl = await enforceReadRateLimit(
		env,
		request,
		cors,
		VIEW_BUDGET,
		screenshotViewPerHour(env),
	);
	if (rl) return rl;

	const rows = await env.SHARE_DB.prepare(
		`SELECT s.screenshot_id, s.game_id, s.r2_key, s.width, s.height, s.caption,
		        g.game_name, g.display_name, g.user_nation, g.total_turns
		 FROM game_screenshots s
		 JOIN games g ON g.game_id = s.game_id
		 WHERE s.user_id = ? AND s.hidden_at IS NULL
		 ORDER BY s.created_at DESC, s.rowid DESC`,
	)
		.bind(userId)
		.all<ScreenshotGameRow>();

	return jsonResponse(
		{
			screenshots: (rows.results ?? []).map((r) => ({
				...serializeScreenshot(env, r),
				game: {
					game_name: r.game_name,
					display_name: r.display_name,
					user_nation: r.user_nation,
					total_turns: r.total_turns,
				},
			})),
		},
		200,
		cors,
	);
}

// ---------- Delete ----------

interface OwnedScreenshotRow {
	r2_key: string;
}

// DELETE /v1/games/:id/screenshots/:screenshot_id — the uploader removes their
// own screenshot. Permanent: there is no hidden-but-kept state for an owner,
// only for the classifier's uncertain band and step 6's admin hide.
//
// This endpoint is what makes the HAS_SCREENSHOTS refusal honest. Without it a
// game with a screenshot could not be made private by any route its owner has
// — the lock would offer "Make private", flip optimistically, and revert on a
// 409 naming a remedy nobody could carry out.
//
// Three steps, the same three the admin hide will take: the D1 row, the R2
// object, then both URLs out of the edge cache. D1 first, because that is the
// one a reader consults — an object that outlived its row renders nowhere,
// while a row that outlived its object renders a broken tile.
//
// Deliberately NOT rate-limited. A delete is bounded by what the account
// uploaded: the 100-per-account cap bounds the total, and replacing a deleted
// screenshot costs a classifier attempt out of the hourly upload budget. So
// the upload ceiling already bounds how fast this can be driven, and a second
// counter would bound nothing new.
export async function handleScreenshotDelete(
	gameId: string,
	screenshotId: string,
	request: Request,
	env: ScreenshotsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");
	const userId = session.data.user_id;

	// The DELETE carries the same three predicates, so ownership is enforced
	// by the statement and not by the read above it — the read is here for the
	// r2_key, which is what the object and both URLs are built from. 404 for
	// "no such screenshot", "not on that game" and "not yours" alike: the
	// shape the upload's own 404 uses, so the message has to be true of each.
	const row = await env.SHARE_DB.prepare(
		`SELECT r2_key FROM game_screenshots
		 WHERE screenshot_id = ? AND game_id = ? AND user_id = ?`,
	)
		.bind(screenshotId, gameId, userId)
		.first<OwnedScreenshotRow>();
	if (!row) {
		return errorResponse(
			"That screenshot is gone, or it isn't yours",
			404,
			cors,
			"NOT_FOUND",
		);
	}

	await env.SHARE_DB.prepare(
		`DELETE FROM game_screenshots
		 WHERE screenshot_id = ? AND game_id = ? AND user_id = ?`,
	)
		.bind(screenshotId, gameId, userId)
		.run();

	await removeScreenshot(env, row.r2_key, screenshotId);

	await recordEvent(env, "screenshot_delete", userId, request, {
		screenshot_id: screenshotId,
		game_id: gameId,
	});

	return jsonResponse({ ok: true }, 200, cors);
}

// ---------- Terms ----------

// POST /v1/users/me/screenshot-terms — the one-time acceptance the upload
// endpoint refuses without.
//
// Set-once in the statement rather than by a read-then-write: COALESCE keeps
// the original timestamp, so a second POST is idempotent and the RETURNING
// value is the acceptance either way. What the column records is when the
// user agreed, and a re-POST is not a second agreement.
export async function handleAcceptScreenshotTerms(
	request: Request,
	env: ScreenshotsEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);

	const session = await sessionFromRequest(env, request);
	if (!session) return errorResponse("Unauthorized", 401, cors, "UNAUTHORIZED");

	const body = await parseJsonBody(request, AcceptScreenshotTermsSchema, cors);
	if (!body.ok) return body.response;

	const row = await env.SHARE_DB.prepare(
		`UPDATE users
		    SET screenshot_terms_accepted_at =
		          COALESCE(screenshot_terms_accepted_at, datetime('now'))
		  WHERE user_id = ?
		 RETURNING screenshot_terms_accepted_at`,
	)
		.bind(session.data.user_id)
		.first<TermsRow>();
	if (!row || row.screenshot_terms_accepted_at == null) {
		// No users row behind a live session: the session outlived the account.
		return errorResponse("Not found", 404, cors, "NOT_FOUND");
	}

	return jsonResponse(
		{ screenshot_terms_accepted_at: row.screenshot_terms_accepted_at },
		200,
		cors,
	);
}

// ---------- Audit ----------

// The module's own insert, the shape challenges/handlers.ts uses: a closed
// event-type union so a typo is a compile error, and a failure logged rather
// than thrown — an audit row is not worth losing a stored screenshot for.
async function recordEvent(
	env: ScreenshotsEnv,
	eventType:
		"screenshot_upload_attempt" | "screenshot_upload" | "screenshot_delete",
	userId: string,
	request: Request,
	metadata: Record<string, unknown> | null,
): Promise<void> {
	try {
		await env.EVENTS_DB.prepare(
			`INSERT INTO events (event_type, user_id, ip_address, metadata)
			 VALUES (?, ?, ?, ?)`,
		)
			.bind(
				eventType,
				userId,
				getClientIp(request),
				metadata == null ? null : JSON.stringify(metadata),
			)
			.run();
	} catch (e) {
		logError("audit_event_log_failed", e, { event_type: eventType });
	}
}
