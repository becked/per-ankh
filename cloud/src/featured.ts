// Site-admin "featured videos" — the curated set, stored in D1.
//
// Every other video surface (the home creator strip, a profile's Videos tab, a
// tournament's playlist) reads live from the platform and caches in KV; nothing
// is persisted. Featuring can't work that way: a featured video ages out of the
// source feed, so the row carries a SNAPSHOT of the fields the platform owns
// (see migration 0041). What it deliberately does NOT snapshot is the
// uploader's name and avatar — `user_id` names a Per-Ankh uploader and this
// module joins `users` at read time (displayNameSql + buildAvatarUrl), the way
// every other read builds identity, so a rename is reflected here too.
//
// Writes are admin-only. The set itself is public — the signed-out home page
// leads with the newest featured video (GET /v1/featured-videos, below).

import { isSiteAdmin, type AdminAuthEnv } from "./admin";
import { buildAvatarUrl } from "./auth";
import { displayNameSql } from "./identity";
import { logError } from "./log";
import { FeatureVideoSchema } from "./schemas/featured";
import { sessionFromRequest, type SessionEnv } from "./session";
import type { Video } from "./video/types";
import {
	cloudCorsHeaders,
	errorResponse,
	jsonResponse,
	parseJsonBody,
} from "./util";
import type { VideoPlatform } from "./video/types";
import type { QueryableD1 } from "./d1";

// The public feed needs no session — only the table and the CORS origins.
export interface PublicFeaturedVideosEnv {
	SHARE_DB: QueryableD1;
	ALLOWED_ORIGINS: string;
}

export interface FeaturedVideosEnv
	extends SessionEnv, AdminAuthEnv, PublicFeaturedVideosEnv {}

// Display cap on the public feed, matching the two sibling video feeds
// (MAX_CREATOR_FEED_VIDEOS / MAX_TOURNAMENT_FEED_VIDEOS) and the home page's
// VIDEO_STRIP_SIZE. The admin list stays uncapped — the Featured tab manages
// the whole set, so it has to see all of it.
const MAX_FEATURED_FEED_VIDEOS = 12;

// One row of the read query: the stored snapshot, plus the uploader's live
// identity from the LEFT JOIN (all four join columns null when the row names no
// Per-Ankh user). `platform` is typed as the union because the write schema
// only accepts platforms with a registered provider.
export interface FeaturedVideoRow {
	platform: VideoPlatform;
	video_id: string;
	url: string;
	title: string;
	thumbnail_url: string | null;
	published_at: string;
	uploader_name: string | null;
	uploader_url: string | null;
	user_id: string | null;
	display_name: string | null;
	slug: string | null;
	discord_id: string | null;
	avatar_hash: string | null;
}

// Attribute one row's uploader, three ways — the same discrimination the
// tournament playlist read applies (attributePlaylistVideos in
// tournament/public.ts) and the frontend's TournamentVideo union mirrors: a
// linked Per-Ankh user renders with their live Discord identity, an unlinked
// YouTube channel with the snapshotted channel name + URL, and a video whose
// feed entry named no author carries no attribution at all.
//
// The join, not the stored user_id, decides the first branch — there is no name
// or avatar to render without it, so a row whose join came back empty falls
// through to the next branch rather than producing a nameless card.
export function attributeFeaturedVideo(row: FeaturedVideoRow) {
	const base: Video = {
		id: row.video_id,
		title: row.title,
		url: row.url,
		thumbnail_url: row.thumbnail_url,
		published_at: row.published_at,
		platform: row.platform,
		// Featured rows are D1 snapshots taken when a video was starred, and the
		// table has no duration column — so this is null for every featured
		// video, not merely unknown for some. Typed as Video rather than left
		// inferred so the next field added to Video fails here instead of
		// silently shipping a featured card that is missing it.
		duration_seconds: null,
	};
	if (
		row.user_id != null &&
		row.display_name != null &&
		row.discord_id != null
	) {
		return {
			...base,
			user_id: row.user_id,
			display_name: row.display_name,
			slug: row.slug,
			avatar_url: buildAvatarUrl(row.discord_id, row.avatar_hash),
		};
	}
	if (row.uploader_name != null && row.uploader_url != null) {
		return {
			...base,
			uploader_name: row.uploader_name,
			uploader_url: row.uploader_url,
		};
	}
	return base;
}

// The featured set, newest video first — the one read behind both the admin
// list and the public feed, so the snapshot columns and the live identity join
// can't drift apart between them. `cap` bounds the public feed; omitted, the
// query returns the whole set.
async function selectFeaturedVideos(
	db: QueryableD1,
	cap?: number,
): Promise<ReturnType<typeof attributeFeaturedVideo>[]> {
	const statement = db.prepare(
		`SELECT f.platform, f.video_id, f.url, f.title, f.thumbnail_url,
		        f.published_at, f.uploader_name, f.uploader_url, f.user_id,
		        ${displayNameSql("u")} AS display_name,
		        u.slug, u.discord_id, u.avatar_hash
		 FROM featured_videos f
		 LEFT JOIN users u ON u.user_id = f.user_id
		 ORDER BY f.published_at DESC${cap != null ? " LIMIT ?" : ""}`,
	);
	const rows = await (
		cap != null ? statement.bind(cap) : statement
	).all<FeaturedVideoRow>();
	return (rows.results ?? []).map(attributeFeaturedVideo);
}

// GET /v1/admin/featured-videos — the whole featured set, newest video first.
// Uncapped: the set is hand-curated, so its size is an admin decision.
export async function handleListFeaturedVideos(
	request: Request,
	env: FeaturedVideosEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!(await isSiteAdmin(env, session))) {
		return errorResponse("Not found", 404, cors, "NOT_FOUND");
	}

	return jsonResponse(
		{ videos: await selectFeaturedVideos(env.SHARE_DB) },
		200,
		cors,
	);
}

// GET /v1/featured-videos — the public feed, newest video first and capped.
// The signed-out home page leads with its first entry.
//
// Response shaping mirrors the sibling public video feeds (handleCreatorVideos,
// handleTournamentVideosFeed): best-effort, so a D1 hiccup answers an empty
// feed rather than 500-ing the page the home load calls it from; 60s of edge
// cache so repeated home hits don't re-run the join at the origin, with no
// browser cache so an admin's star shows up on reload; and Vary: Origin because
// the CORS headers are origin-specific on a shared-cacheable response.
//
// Deliberately outside the anon_read budget, like both siblings — the home page
// fires all three on every anonymous load, and they answer 200 by construction.
export async function handlePublicFeaturedVideos(
	request: Request,
	env: PublicFeaturedVideosEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	let videos: ReturnType<typeof attributeFeaturedVideo>[] = [];
	try {
		videos = await selectFeaturedVideos(env.SHARE_DB, MAX_FEATURED_FEED_VIDEOS);
	} catch (e) {
		logError("featured_feed_fetch_failed", e);
	}
	return new Response(JSON.stringify({ videos }), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "public, max-age=0, s-maxage=60",
			...cors,
			Vary: "Origin",
		},
	});
}

// POST /v1/admin/featured-videos — feature a video, by snapshot. Upserts on
// (platform, video_id): re-featuring one that's already in the set refreshes
// its snapshot (a re-titled video, a rotated thumbnail) rather than failing,
// which also makes the star toggle safe to press twice.
export async function handleFeatureVideo(
	request: Request,
	env: FeaturedVideosEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	// The `!session` leg is redundant against isSiteAdmin (which returns false
	// without one) and carries its weight by narrowing the session for
	// featured_by below.
	if (!session || !(await isSiteAdmin(env, session))) {
		return errorResponse("Not found", 404, cors, "NOT_FOUND");
	}

	const parsed = await parseJsonBody(request, FeatureVideoSchema, cors);
	if (!parsed.ok) return parsed.response;
	const body = parsed.body;

	await env.SHARE_DB.prepare(
		`INSERT INTO featured_videos (
		   platform, video_id, url, title, thumbnail_url, published_at,
		   user_id, uploader_name, uploader_url, featured_by
		 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(platform, video_id) DO UPDATE SET
		   url           = excluded.url,
		   title         = excluded.title,
		   thumbnail_url = excluded.thumbnail_url,
		   published_at  = excluded.published_at,
		   user_id       = excluded.user_id,
		   uploader_name = excluded.uploader_name,
		   uploader_url  = excluded.uploader_url,
		   featured_at   = datetime('now'),
		   featured_by   = excluded.featured_by`,
	)
		.bind(
			body.platform,
			body.video_id,
			body.url,
			body.title,
			body.thumbnail_url,
			body.published_at,
			body.user_id,
			body.uploader_name,
			body.uploader_url,
			session.data.user_id,
		)
		.run();

	return jsonResponse({ ok: true }, 200, cors);
}

// DELETE /v1/admin/featured-videos/:platform/:video_id — unfeature. Idempotent:
// deleting a video that isn't featured still succeeds, so the star toggle and
// the Featured tab's Remove don't have to agree on who got there first
// (mirrors handleDeleteChannel).
export async function handleUnfeatureVideo(
	platform: string,
	videoId: string,
	request: Request,
	env: FeaturedVideosEnv,
): Promise<Response> {
	const cors = cloudCorsHeaders(env, request);
	const session = await sessionFromRequest(env, request);
	if (!(await isSiteAdmin(env, session))) {
		return errorResponse("Not found", 404, cors, "NOT_FOUND");
	}

	await env.SHARE_DB.prepare(
		"DELETE FROM featured_videos WHERE platform = ? AND video_id = ?",
	)
		.bind(platform, videoId)
		.run();

	return jsonResponse({ ok: true }, 200, cors);
}
