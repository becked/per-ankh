// Per-screen capture against the running dev server. Every function here
// takes a Playwright page already sized to one breakpoint and returns
// CaptureRecords; writing files is the orchestrator's job (index.ts).
//
// Each (pass × page × tab) is one "screen", captured at every breakpoint via
// a *fresh navigation* at that viewport — components that pick a layout at
// mount (responsive nav, ECharts/deck.gl sizing) won't re-derive it on a
// resize, so we re-navigate rather than resize a live page.

import sharp from "sharp";
import type { Page } from "playwright";

import type { Breakpoint, CaptureRecord, Pass, ReviewIds } from "./types";

const JPEG_QUALITY = 72;

// Captured at deviceScaleFactor 1, so the JPEG is the screen's CSS-pixel
// width — small enough to commit, sharp enough for the lightbox to read type.
export const BREAKPOINTS: Breakpoint[] = [
	{ id: "desktop", label: "Desktop", width: 1440, height: 900 },
	{ id: "tablet", label: "Tablet", width: 768, height: 1024 },
	{ id: "mobile", label: "Mobile", width: 390, height: 844 },
];

interface GameTab {
	label: string;
	// Triggers GameDetailView renders conditionally. Their absence is a fact
	// about the game, not a capture failure, so they're skipped rather than
	// recorded as an error.
	optional?: boolean;
}

// Game-detail tabs in nav order, mirroring GAME_TABS in
// src/lib/game-detail/game-tabs.svelte.ts, which GameDetailView's Tabs.List
// renders. `label` is the trigger's accessible name (bits-ui Tabs.Trigger emits
// role="tab"); getByRole matches by accessible name and survives Tailwind
// churn. The Tabs.List uses flex-wrap, so every trigger stays a clickable
// role="tab" even at mobile width (no dropdown collapse). "Timeline" is
// commented out of GAME_TABS ("hidden pending redesign") so it's omitted here.
const GAME_TABS: GameTab[] = [
	{ label: "Overview" },
	{ label: "Events" },
	// Gated on hasLeaders — a blob has rulers only from OW 2.8.0 on.
	{ label: "Leaders", optional: true },
	{ label: "Laws" },
	{ label: "Techs" },
	{ label: "Orders" },
	{ label: "Yields" },
	{ label: "Military" },
	{ label: "Cities" },
	{ label: "Economy" },
	{ label: "Wonders" },
	{ label: "Families" },
	{ label: "Specialists" },
	{ label: "Settings" },
];

// User-profile tabs are URL-driven (?tab=…) and the load() refetches per tab,
// so we navigate by URL rather than clicking. In the order ProfilePage's
// Tabs.List renders them, minus the tabs no pass can reach: Tournaments and
// Videos need the profile to have a tournament or a channel, and Suggested is
// the owner's own.
//
// `optional` is GAME_TABS' flag for GAME_TABS' reason — a profile without
// screenshots is a fact about that user, not a capture failure. It matters
// more here than a skip usually would: profile-load falls a stale
// ?tab=screenshots back to the default tab, so without the check the shot
// would be a second copy of Overview filed under the Screenshots name.
const USER_TABS: { label: string; param: string; optional?: boolean }[] = [
	{ label: "Overview", param: "overview" },
	{ label: "Games", param: "games" },
	{ label: "Screenshots", param: "screenshots", optional: true },
	{ label: "Stats", param: "stats" },
];

// /admin's tabs, in the order its Tabs.List renders them. Clicked rather than
// navigated to, because the page holds the selection in client state
// (`activeTab`) and never puts it in the URL — the game-detail shape. None is
// conditional: the whole page is behind the site-admin gate that the capture
// itself is gated on.
const ADMIN_TABS = ["Reparse", "Featured", "Ratings", "Screenshots"];

// Redirect-only routes — verified (not screenshotted). `note` documents the
// intended destination.
const REDIRECT_ROUTES = [
	{ route: "/dashboard", note: "→ /users/[id] (signed in) · /?next= (anon)" },
	{ route: "/games", note: "→ /dashboard → profile" },
	{ route: "/auth/callback", note: "OAuth landing (not renderable)" },
];

// The home page's cold-start branches. Every home feed degrades to an empty
// list on failure (see +page.ts), and +page.svelte reshapes around what's
// left: with no videos the Recent Videos panel drops and the games feed
// widens to the full row with its cards two-up; with no featured video the
// hero loses its video tile and the tournament panel stands alone; with no
// starred screenshots the Screenshots strip drops out of the row above the
// discovery grid; with no public games the feed swaps in its empty-state copy.
// Live local feeds never produce any of that, so we stub the endpoints backing
// them.
const COLD_HOME_FEEDS: Record<string, unknown> = {
	"**/v1/creator-videos*": { videos: [] },
	"**/v1/tournament-videos*": { videos: [] },
	"**/v1/featured-videos*": { videos: [] },
	"**/v1/featured-screenshots*": { screenshots: [] },
};
const COLD_GAME_FEED: Record<string, unknown> = {
	"**/v1/games/public-recent*": { games: [] },
};

// Cold variants of home, in capture order. `stubs` maps a URL glob to the
// JSON body its route handler answers with.
interface ColdState {
	key: string;
	title: string;
	stubs: Record<string, unknown>;
}
const HOME_COLD_STATES: ColdState[] = [
	{ key: "cold-feed", title: "Cold feed", stubs: COLD_HOME_FEEDS },
	{
		key: "cold-start",
		title: "Cold start",
		stubs: { ...COLD_HOME_FEEDS, ...COLD_GAME_FEED },
	},
];

function slug(s: string): string {
	return String(s)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

// Settle async client rendering (ECharts, deck.gl map) after a navigation or
// tab switch. We can't wait on full "networkidle" — external avatar images
// (Discord CDN) keep the connection pool busy indefinitely — so cap the idle
// wait and add a fixed render settle.
async function settle(page: Page): Promise<void> {
	await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
	await page.waitForTimeout(900);
	await page.evaluate(() => window.scrollTo(0, 0));
}

// Capture the current page full-height and return a JPEG buffer.
async function shoot(page: Page): Promise<Buffer> {
	const png = await page.screenshot({ type: "png", fullPage: true });
	return sharp(png).jpeg({ quality: JPEG_QUALITY }).toBuffer();
}

// --- Per-screen capture --------------------------------------------------
//
// `id` doubles as the file-stem and the manifest key:
//   {pass}__{page}            single-shot pages
//   {pass}__{page}__{tab}     tabbed pages

interface SingleSpec {
	id: string;
	pass: Pass;
	page: string;
	tab: string | null;
	title: string;
	route: string;
	state: string;
	// Appended to the status/landing detail when the page doesn't render.
	errorHint: string;
}

// Single full-page shot. A non-OK status OR a silent redirect away from the
// requested path becomes an error — a gated page that 30x's to / still
// returns 200 on the landing page, so status alone isn't enough.
async function captureSingle(
	page: Page,
	baseUrl: string,
	spec: SingleSpec,
): Promise<CaptureRecord> {
	const { errorHint, ...rec } = spec;
	const expectedPath = spec.route.split("?")[0];
	const resp = await page.goto(`${baseUrl}${spec.route}`, {
		waitUntil: "load",
	});
	const landedPath = new URL(page.url()).pathname;
	if (!resp || !resp.ok() || landedPath !== expectedPath) {
		return {
			...rec,
			error: `${errorHint} (status ${
				resp ? resp.status() : "none"
			}, landed ${landedPath})`,
		};
	}
	await settle(page);
	return { ...rec, buf: await shoot(page) };
}

// Home, with one or more of its feeds stubbed empty. Yields one record.
//
// SSR is on (src/routes/+layout.ts), so a fresh goto("/") runs +page.ts on the
// SvelteKit server and its fetches never touch the browser — out of reach of
// Playwright's route handlers. So we land on another route, install the stubs,
// then click the header wordmark: that client-side navigation re-runs the same
// load in the browser, where the handlers do apply. Same component off the same
// data shape, so the render matches what a cold SSR load would produce.
async function captureHomeCold(
	page: Page,
	baseUrl: string,
	pass: Pass,
	ids: ReviewIds,
	coldState: ColdState,
	authState: string,
): Promise<CaptureRecord> {
	const spec = {
		pass,
		page: "home",
		id: `${pass}__home__${coldState.key}`,
		tab: coldState.title,
		title: coldState.title,
		route: "/",
		state: authState,
	};

	// Any route but / — clicking the wordmark while already home is a no-op,
	// and the load would never re-run. Game detail renders in both passes.
	await page.goto(`${baseUrl}/games/${ids.gameId}`, { waitUntil: "load" });
	// Settle before clicking: `load` fires before SvelteKit has hydrated, and a
	// click on an unhydrated link is a native document navigation — which
	// server-renders / and runs the load out of the browser's reach, so the
	// stubs below never apply and the shot is a duplicate of warm home.
	await settle(page);

	const patterns = Object.keys(coldState.stubs);
	for (const pattern of patterns) {
		const body = coldState.stubs[pattern];
		await page.route(pattern, (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				// The client calls the Worker cross-origin with
				// `credentials: "include"` (api-cloud's request()), so a fulfilled
				// response still has to clear CORS — and a credentialed request
				// rejects a wildcard origin, so echo the one that was sent.
				headers: {
					"access-control-allow-origin":
						route.request().headers()["origin"] ?? baseUrl,
					"access-control-allow-credentials": "true",
				},
				body: JSON.stringify(body),
			}),
		);
	}

	try {
		const wordmark = page.getByRole("link", { name: "Per Ankh — home" });
		if ((await wordmark.count()) === 0) {
			return {
				...spec,
				error: "Header wordmark not found — can't reach / client-side.",
			};
		}
		await wordmark.first().click();
		await page.waitForURL((u) => u.pathname === "/", { timeout: 10_000 });
		await settle(page);
		return { ...spec, buf: await shoot(page) };
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		return { ...spec, error: `Cold-state capture failed: ${msg}` };
	} finally {
		// Handlers are per-page and this page is reused by the next capture.
		for (const pattern of patterns) await page.unroute(pattern);
	}
}

// Game detail — click through every tab. Yields one record per tab present.
async function captureGameDetail(
	page: Page,
	baseUrl: string,
	pass: Pass,
	gameId: string,
	state: string,
): Promise<CaptureRecord[]> {
	const route = `/games/${gameId}`;
	const base = { pass, page: "game-detail", route, state };
	const resp = await page.goto(`${baseUrl}${route}`, { waitUntil: "load" });
	const tabsAppeared = await page
		.getByRole("tab", { name: "Overview" })
		.waitFor({ state: "visible", timeout: 10_000 })
		.then(() => true)
		.catch(() => false);

	if (!resp || !resp.ok() || !tabsAppeared) {
		return [
			{
				...base,
				id: `${pass}__game-detail`,
				tab: null,
				title: "Game detail",
				error:
					"Tabs never appeared — game may be private, missing, or redirected.",
			},
		];
	}

	const recs: CaptureRecord[] = [];
	for (const { label, optional } of GAME_TABS) {
		const id = `${pass}__game-detail__${slug(label)}`;
		const tab = page.getByRole("tab", { name: label, exact: true });
		if ((await tab.count()) === 0) {
			if (optional) continue;
			recs.push({
				...base,
				id,
				tab: label,
				title: label,
				error: "Tab not found",
			});
			continue;
		}
		await tab.click();
		await settle(page);
		recs.push({
			...base,
			id,
			tab: label,
			title: label,
			buf: await shoot(page),
		});
	}
	return recs;
}

// The game's other view (/games/[id]/map): the map under its chrome, one shot.
// The chrome's lightboxes and the city popover are interaction states this
// walkthrough doesn't drive, so what's captured is the view as it opens.
async function captureGameMap(
	page: Page,
	baseUrl: string,
	pass: Pass,
	gameId: string,
	state: string,
): Promise<CaptureRecord> {
	return captureSingle(page, baseUrl, {
		id: `${pass}__game-map`,
		pass,
		page: "game-map",
		tab: null,
		title: "Map view",
		route: `/games/${gameId}/map`,
		state,
		errorHint: "Map view failed — game may be private, missing, or redirected",
	});
}

// The game's third view (/games/[id]/screenshots): a panel per screenshot,
// one shot. Captured in both passes like the map view, because the picture is
// not all that differs between them — the gallery's delete control renders for
// the owner and its star for an admin, and the anonymous shot has neither.
//
// Captured on the game the run found a screenshot on rather than on the walked
// one, which is why the route is threaded in rather than taken from ids.gameId.
async function captureGameScreenshots(
	page: Page,
	baseUrl: string,
	pass: Pass,
	gameId: string,
	state: string,
): Promise<CaptureRecord> {
	return captureSingle(page, baseUrl, {
		id: `${pass}__game-screenshots`,
		pass,
		page: "game-screenshots",
		tab: null,
		title: "Screenshots view",
		route: `/games/${gameId}/screenshots`,
		state,
		errorHint:
			"Screenshots view failed — game may be private, missing, or redirected",
	});
}

// User profile — URL-driven tabs (?tab=…). Yields one record per tab.
async function captureUserProfile(
	page: Page,
	baseUrl: string,
	pass: Pass,
	userId: string,
	state: string,
): Promise<CaptureRecord[]> {
	const route = `/users/${userId}`;
	const base = { pass, page: "user-profile", state };
	const recs: CaptureRecord[] = [];
	for (const { label, param, optional } of USER_TABS) {
		const id = `${pass}__user-profile__${param}`;
		const url = `${route}?tab=${param}`;
		const resp = await page.goto(`${baseUrl}${url}`, { waitUntil: "load" });
		const ready = await page
			.getByRole("tab", { name: "Overview" })
			.waitFor({ state: "visible", timeout: 10_000 })
			.then(() => true)
			.catch(() => false);
		if (ready && optional) {
			const trigger = page.getByRole("tab", { name: label, exact: true });
			if ((await trigger.count()) === 0) continue;
		}
		if (!resp || !resp.ok() || !ready) {
			recs.push({
				...base,
				id,
				tab: label,
				route: url,
				title: label,
				error: "Profile tabs never appeared — page may have redirected home.",
			});
			continue;
		}
		await settle(page);
		recs.push({
			...base,
			id,
			tab: label,
			route: url,
			title: label,
			buf: await shoot(page),
		});
	}
	return recs;
}

// /admin — click through every tab. Yields one record per tab. Same shape as
// game detail, for the same reason: the tabs are different jobs on one page
// rather than one view, so a single shot of whichever one happens to be active
// leaves the other three unreviewed.
async function captureAdmin(
	page: Page,
	baseUrl: string,
	pass: Pass,
): Promise<CaptureRecord[]> {
	const route = "/admin";
	const base = { pass, page: "admin", route, state: "admin" };
	const resp = await page.goto(`${baseUrl}${route}`, { waitUntil: "load" });
	const landedPath = new URL(page.url()).pathname;
	if (!resp || !resp.ok() || landedPath !== route) {
		return [
			{
				...base,
				id: `${pass}__admin`,
				tab: null,
				title: "Admin",
				error:
					"Admin page unavailable — auth user is not the local admin " +
					`(status ${resp ? resp.status() : "none"}, landed ${landedPath})`,
			},
		];
	}

	const recs: CaptureRecord[] = [];
	for (const label of ADMIN_TABS) {
		const id = `${pass}__admin__${slug(label)}`;
		const tab = page.getByRole("tab", { name: label, exact: true });
		if ((await tab.count()) === 0) {
			recs.push({
				...base,
				id,
				tab: label,
				title: label,
				error: "Tab not found",
			});
			continue;
		}
		await tab.click();
		await settle(page);
		recs.push({
			...base,
			id,
			tab: label,
			title: label,
			buf: await shoot(page),
		});
	}
	return recs;
}

// Verify the redirect-only routes 30x rather than render. One text record.
async function captureRedirects(
	page: Page,
	baseUrl: string,
	pass: Pass,
): Promise<CaptureRecord> {
	const lines: string[] = [];
	for (const { route, note } of REDIRECT_ROUTES) {
		try {
			await page.goto(`${baseUrl}${route}`, { waitUntil: "load" });
			lines.push(`${route} → ${new URL(page.url()).pathname}  (${note})`);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			lines.push(`${route} → error: ${msg}`);
		}
	}
	return {
		pass,
		page: "redirects",
		id: `${pass}__redirects`,
		tab: null,
		title: "Redirect routes",
		route: "(verification)",
		state: "—",
		note: lines.join("\n"),
	};
}

// Run the anonymous pass at the current viewport. Returns records.
export async function captureAnon(
	page: Page,
	baseUrl: string,
	ids: ReviewIds,
): Promise<CaptureRecord[]> {
	const recs: CaptureRecord[] = [];
	recs.push(
		await captureSingle(page, baseUrl, {
			id: "anon__home",
			pass: "anon",
			page: "home",
			tab: null,
			title: "Home",
			route: "/",
			state: "visitor",
			errorHint: "Home failed",
		}),
	);
	for (const coldState of HOME_COLD_STATES) {
		recs.push(
			await captureHomeCold(page, baseUrl, "anon", ids, coldState, "visitor"),
		);
	}
	recs.push(
		...(await captureGameDetail(page, baseUrl, "anon", ids.gameId, "visitor")),
	);
	recs.push(await captureGameMap(page, baseUrl, "anon", ids.gameId, "visitor"));
	if (ids.screenshotGameId) {
		recs.push(
			await captureGameScreenshots(
				page,
				baseUrl,
				"anon",
				ids.screenshotGameId,
				"visitor",
			),
		);
	}
	recs.push(
		...(await captureUserProfile(page, baseUrl, "anon", ids.userId, "visitor")),
	);
	return recs;
}

export interface AuthOpts {
	isAdmin: boolean;
	tournamentSlug: string | null;
	// Whether the signed-in user owns the game being walked. The signed-in
	// pass defaults to the local admin while the game is picked at random, so
	// the two need not coincide — and the owner-only controls on game detail
	// render only when they do.
	ownsGame: boolean;
	// The same question for the game the screenshots view is captured on, which
	// is a second game: the gallery's delete control is the owner's.
	ownsScreenshotGame: boolean;
}

// Run the signed-in pass at the current viewport. Returns records.
export async function captureAuth(
	page: Page,
	baseUrl: string,
	ids: ReviewIds,
	opts: AuthOpts,
): Promise<CaptureRecord[]> {
	const recs: CaptureRecord[] = [];
	recs.push(
		await captureSingle(page, baseUrl, {
			id: "auth__home",
			pass: "auth",
			page: "home",
			tab: null,
			title: "Home",
			route: "/",
			state: "signed in",
			errorHint: "Home failed",
		}),
	);
	for (const coldState of HOME_COLD_STATES) {
		recs.push(
			await captureHomeCold(page, baseUrl, "auth", ids, coldState, "signed in"),
		);
	}
	recs.push(
		...(await captureUserProfile(
			page,
			baseUrl,
			"auth",
			ids.authUserId,
			"owner",
		)),
	);
	recs.push(
		await captureSingle(page, baseUrl, {
			id: "auth__account",
			pass: "auth",
			page: "account",
			tab: null,
			title: "Account",
			route: "/account",
			state: "owner",
			errorHint: "Account redirected — session may not have been picked up",
		}),
	);
	recs.push(
		...(await captureGameDetail(
			page,
			baseUrl,
			"auth",
			ids.gameId,
			opts.ownsGame ? "owner" : "signed in",
		)),
	);
	recs.push(
		await captureGameMap(
			page,
			baseUrl,
			"auth",
			ids.gameId,
			opts.ownsGame ? "owner" : "signed in",
		),
	);
	if (ids.screenshotGameId) {
		recs.push(
			await captureGameScreenshots(
				page,
				baseUrl,
				"auth",
				ids.screenshotGameId,
				opts.ownsScreenshotGame ? "owner" : "signed in",
			),
		);
	}
	recs.push(
		await captureSingle(page, baseUrl, {
			id: "auth__tournaments",
			pass: "auth",
			page: "tournaments",
			tab: null,
			title: "Tournaments",
			route: "/tournaments",
			state: "signed in",
			errorHint: "Tournaments unavailable — likely the beta gate (404)",
		}),
	);
	if (opts.tournamentSlug) {
		recs.push(
			await captureSingle(page, baseUrl, {
				id: "auth__tournament-detail",
				pass: "auth",
				page: "tournament-detail",
				tab: null,
				title: `Tournament: ${opts.tournamentSlug}`,
				route: `/tournaments/${opts.tournamentSlug}`,
				state: "signed in",
				errorHint: "Tournament detail unavailable (beta gate or missing)",
			}),
		);
	}
	if (opts.isAdmin) {
		recs.push(...(await captureAdmin(page, baseUrl, "auth")));
	}
	recs.push(await captureRedirects(page, baseUrl, "auth"));
	return recs;
}
