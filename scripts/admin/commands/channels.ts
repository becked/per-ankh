// `./per-ankh admin add-channel <user_id> <url|@handle>` — link a creator's
// video channel to a user account on their behalf.
//
// The public feature is self-service: a user pastes their channel URL in
// account settings and the Worker resolves + stores it (POST /v1/auth/channels,
// cloud/src/channels.ts). This command is the operator equivalent for
// bootstrapping known creators. It reuses the Worker's EXACT resolution path
// (cloud/src/video) so the stored (platform, channel_url, channel_id) is
// identical to what the self-service endpoint would write, then issues the same
// upsert. The account must already exist — user_video_channels FKs to users, so
// a creator still has to have logged in via Discord at least once.
//
// Resolving an @handle / legacy /user/ URL needs a one-shot YouTube Data API
// lookup (and thus a key); a …/channel/UC… URL resolves with no key. The key is
// sourced from YOUTUBE_API_KEY in the environment or cloud/.dev.vars — the same
// secret the local Worker uses.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	type Column,
	emdash,
	formatDate,
	info,
	ok,
	printCount,
	printDetail,
	printTable,
	trunc,
	warn,
} from "../../lib/format";
import {
	type CommandOpts,
	flagInt,
	parseFlags,
	printJson,
} from "../../lib/cli";
import { readDotVars } from "../../lib/dotvars";
import { d1Exec, d1Query, sqlStr } from "../wrangler";
// cloud/ is a CJS package (no "type":"module") while scripts/ runs as ESM, so
// the video registry's named exports surface only through the default-interop
// object (mirrors the tournament-seed import in ./tournament.ts). Types are
// erased at runtime, so they import cleanly by name.
import videoRegistry from "../../../cloud/src/video/registry";
import type { VideoEnv } from "../../../cloud/src/video/types";
const { providerForUrl, supportedPlatforms } = videoRegistry;

// scripts/admin/commands/channels.ts → repo root is three levels up.
const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);
const DEV_VARS_PATH = resolve(REPO_ROOT, "cloud", ".dev.vars");

// Mirrors AddChannelSchema's bound (cloud/src/schemas/channel.ts).
const MAX_URL_LEN = 500;

// The Worker reads YOUTUBE_API_KEY from a wrangler secret; the CLI resolves the
// same way the local Worker does — process env first, else cloud/.dev.vars.
// Only @handle / /user/ resolution needs it; …/channel/UC… works without.
function youtubeApiKey(): string | undefined {
	return (
		process.env.YOUTUBE_API_KEY ||
		readDotVars(DEV_VARS_PATH).YOUTUBE_API_KEY ||
		undefined
	);
}

interface UserRow {
	user_id: string;
	display_name: string;
}

interface ChannelRow {
	channel_url: string;
	channel_id: string;
}

export async function runAddChannel(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const userId = positional[0];
	const rawUrl = positional[1];
	if (!userId || !rawUrl) {
		throw new Error(
			"Usage: ./per-ankh admin add-channel <user_id> <url|@handle>",
		);
	}
	const url = rawUrl.trim();
	if (url.length === 0) {
		throw new Error("Channel URL is empty.");
	}
	if (url.length > MAX_URL_LEN) {
		throw new Error(
			`Channel URL too long (${url.length} > ${MAX_URL_LEN} chars).`,
		);
	}

	// user_video_channels FKs to users — verify the account exists first, before
	// any network call, so we fail with a clear message rather than on a raw FK
	// violation. Creators must have signed in at least once.
	const users = await d1Query<UserRow>(
		`SELECT user_id, display_name FROM users WHERE user_id = ${sqlStr(userId)}`,
	);
	const user = users[0];
	if (!user) {
		throw new Error(
			`User not found: ${userId}. The creator must have signed in at least once before a channel can be linked.`,
		);
	}

	const provider = providerForUrl(url);
	if (!provider) {
		throw new Error(
			`That platform isn't supported yet. Supported: ${supportedPlatforms().join(", ")}.`,
		);
	}

	// resolve() reads only env.YOUTUBE_API_KEY (SESSIONS_KV is used by the fetch
	// path, not resolution), so a minimal env is sufficient here.
	const env = { YOUTUBE_API_KEY: youtubeApiKey() } as unknown as VideoEnv;
	if (!env.YOUTUBE_API_KEY) {
		info(
			"No YOUTUBE_API_KEY found (env or cloud/.dev.vars) — only …/channel/UC… URLs resolve without it.",
		);
	}

	info(`Resolving ${provider.platform} channel for ${user.display_name}...`);
	// resolve() throws ChannelResolutionError (a plain Error subclass) carrying a
	// user-safe message — let it propagate to the top-level handler verbatim.
	const identity = await provider.resolve(url, env);

	// Report replace-vs-new the way set-alias reports a prior alias.
	const existing = await d1Query<ChannelRow>(
		`SELECT channel_url, channel_id FROM user_video_channels
		 WHERE user_id = ${sqlStr(userId)} AND platform = ${sqlStr(identity.platform)}`,
	);
	const prior = existing[0];

	// The same upsert handleAddChannel issues (cloud/src/channels.ts) — one
	// channel per (user_id, platform).
	await d1Exec(
		`INSERT INTO user_video_channels (user_id, platform, channel_url, channel_id)
		 VALUES (${sqlStr(userId)}, ${sqlStr(identity.platform)}, ${sqlStr(identity.channel_url)}, ${sqlStr(identity.channel_id)})
		 ON CONFLICT(user_id, platform) DO UPDATE SET
		   channel_url = excluded.channel_url,
		   channel_id  = excluded.channel_id,
		   updated_at  = datetime('now')`,
	);

	// Confirm the stored id points at a live feed: a mistyped …/channel/UC… id
	// stores fine but yields an empty Videos tab, so surface the recent-video
	// count (RSS, no key) as a sanity check. Non-fatal — the row is written.
	let recent = "unavailable";
	try {
		const videos = await provider.fetchRecent(identity.channel_id, env);
		const latest = videos[0];
		recent = latest
			? `${videos.length} (latest: "${trunc(latest.title, 48)}", ${formatDate(latest.published_at)})`
			: "0 — resolved, but no recent uploads found";
		if (!latest) {
			warn(
				"Channel resolved but its feed returned no videos — double-check the URL.",
			);
		}
	} catch (e) {
		recent = `could not fetch (${e instanceof Error ? e.message : String(e)})`;
	}

	if (opts.json) {
		printJson({
			user_id: userId,
			display_name: user.display_name,
			channel: identity,
			previous_channel: prior ?? null,
			replaced: !!prior,
		});
		return;
	}

	ok(
		`${prior ? "Replaced" : "Linked"} ${identity.platform} channel for ${user.display_name} (${userId})`,
	);
	printDetail("Channel", [
		["User", `${user.display_name} (${userId})`],
		["Platform", identity.platform],
		["Channel URL", identity.channel_url],
		["Channel ID", identity.channel_id],
		["Recent videos", recent],
		...(prior
			? ([["Previous", `${prior.channel_url} (${prior.channel_id})`]] as [
					string,
					string,
				][])
			: []),
	]);
}

// `./per-ankh admin remove-channel <user_id> <platform>` — unlink a user's
// channel for one platform. Idempotent (mirrors handleDeleteChannel): removing
// an absent channel is not an error. Platform is not validated against the
// registry so a channel whose provider was later removed can still be deleted.
export async function runRemoveChannel(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { positional } = parseFlags(argv);
	const userId = positional[0];
	const platform = positional[1];
	if (!userId || !platform) {
		throw new Error(
			"Usage: ./per-ankh admin remove-channel <user_id> <platform>",
		);
	}

	// Read the row first so we can report what was removed (and no-op cleanly
	// when there's nothing linked).
	const existing = await d1Query<ChannelRow>(
		`SELECT channel_url, channel_id FROM user_video_channels
		 WHERE user_id = ${sqlStr(userId)} AND platform = ${sqlStr(platform)}`,
	);
	const prior = existing[0];
	if (!prior) {
		if (opts.json) {
			printJson({ user_id: userId, platform, removed: false, channel: null });
			return;
		}
		info(`No ${platform} channel linked for ${userId}. Nothing to remove.`);
		return;
	}

	await d1Exec(
		`DELETE FROM user_video_channels
		 WHERE user_id = ${sqlStr(userId)} AND platform = ${sqlStr(platform)}`,
	);

	if (opts.json) {
		printJson({ user_id: userId, platform, removed: true, channel: prior });
		return;
	}
	ok(`Removed ${platform} channel for ${userId} (was ${prior.channel_url}).`);
}

interface ChannelListRow {
	user_id: string;
	display_name: string;
	platform: string;
	channel_url: string;
	channel_id: string;
	updated_at: string;
}

// `./per-ankh admin list-channels [--limit N]` — every linked creator channel
// across all users (the roster that feeds the home "Latest from creators"
// strip), most-recently-updated first. A single user's channels also show under
// `./per-ankh admin user <id>`.
export async function runListChannels(
	argv: string[],
	opts: CommandOpts,
): Promise<void> {
	const { flags } = parseFlags(argv);
	const limit = flagInt(flags, "limit", 100);

	info(`Listing linked creator channels (limit=${limit})...`);
	const rows = await d1Query<ChannelListRow>(
		`SELECT c.user_id, u.display_name, c.platform, c.channel_url, c.channel_id, c.updated_at
		 FROM user_video_channels c
		 JOIN users u ON u.user_id = c.user_id
		 ORDER BY c.updated_at DESC
		 LIMIT ${limit}`,
	);

	if (opts.json) {
		printJson(rows);
		return;
	}
	if (rows.length === 0) {
		process.stderr.write("No creator channels linked.\n");
		return;
	}

	const cols: Column[] = [
		{ header: "NAME", width: 20 },
		{ header: "USER_ID", width: 22 },
		{ header: "PLATFORM", width: 8 },
		{ header: "CHANNEL_URL", width: 38 },
		{ header: "UPDATED", width: 16 },
	];
	printTable(
		cols,
		rows.map((r) => [
			emdash(r.display_name),
			r.user_id,
			r.platform,
			r.channel_url,
			formatDate(r.updated_at),
		]),
	);
	printCount(rows.length, "channels shown");
}
