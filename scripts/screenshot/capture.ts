// Per-runner capture for `./per-ankh screenshot capture`: one signed-out pass
// over a fixed page list at two viewports, writing `<out>/shots/*.jpg` and
// `<out>/manifest.json`. The Screenshots workflow runs this once per runner
// and uploads the directory as that OS's artifact.
//
// Why a fixed page list rather than ux-review's discovery: everything that
// picks ux-review's subjects is a `wrangler --local` D1 query plus a session
// minted into local KV (scripts/ux-review/discover.ts). A runner has no local
// D1, no R2 blob and no KV, so the subjects have to be named outright — and
// naming them is also what makes two runs of this comparable, which is the
// whole point of the matrix.

import { chromium } from "playwright";
import type { Page } from "playwright";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getEnv } from "../lib/environments";
import { info } from "../lib/format";
import { settle, shoot } from "../lib/page-capture";
import type { Breakpoint, OsManifest, OsShot, PageSpec } from "./types";

export const DEFAULT_BASE_URL = getEnv("staging").frontendOrigin;

// The four surfaces this matrix exists to compare.
//
// The profile is `/users/<user_id>`, not `/u/becked`: a released slug is
// immediately claimable by anyone, so `/u/<name>` can come to point at a
// different person, while `/users/<user_id>` is the permalink that never
// moves (docs/api-reference.md, "Profile slugs"). The permalink costs one
// 307 to the slug route, which `capturePage` records instead of failing on.
//
// A fixed id rather than one discovered per run (`GET /v1/stats/players`
// would answer): every leg resolves its own subjects, so a board that moved
// between two legs would put a different person in two columns of the same
// row — which is the one thing the grid can't survive. The cost is that the
// id has to exist in whatever origin is captured, and `capturePage` says so
// on a 404.
//
// The game is here because it is the surface where the chrome the platform
// paints itself actually shows. `color-scheme` is still absent from all of
// `src/` (#295 §3), and a game page stacks scroll containers the way no
// other page does: the analysis tab strip over a pane whose table sits in
// its own horizontal scroller. Of the 12 `overflow-x-auto` wrappers in
// `src/`, 10 are in `src/lib/game-detail/`; the tournament's two are the
// brackets, declaring `overflow-x: auto` in their own `<style>` blocks
// (ChampionshipBracketTree, SwissFlowBracket), and home and the profile
// have neither. It is the densest surface for §2's rasterization too,
// carrying the small muted type of table headers and chart axes at a volume
// the other three don't.
//
// It has to be a *public* game, because this pass is signed out. The Worker
// answers `GET /v1/games/:id` with 401 for a private one, which the game
// layout (`src/routes/games/[id]/+layout.ts`) turns into a bounce to
// `/?next=…`, and `capturePage` files that as "is this page public?" rather
// than screenshotting the landing page. Same fixed-id argument as the
// profile: `GET /v1/games/public-recent` would answer, but a feed moves
// between legs and would put two different saves in one row.
const PAGES: PageSpec[] = [
	{ id: "home", title: "Home", route: "/" },
	{
		id: "tournament",
		title: "Community Tournament 2026",
		route: "/tournaments/2026-community-tournament",
	},
	{
		id: "profile",
		title: "Public profile",
		route: "/users/rkHvk1UV8SbUSCF505YEV",
	},
	{
		id: "game",
		// "Analysis" is what the view switcher calls this one of a game's
		// three views (GameHeader.svelte).
		title: "Game analysis",
		route: "/games/nT1yYQ-hhg7pN2BgCYU-z",
	},
];

// Desktop and mobile at ux-review's own dimensions, so a shot here reads
// against the bundle in docs/ux-review; its middle (tablet, 768) width is
// dropped because it mostly repeats whichever of the two it sits between.
//
// These are deliberately the same two widths, not the right ones for every
// question: #295 §4 wants 1536 and 1280 — 1920 over Windows' 1.25 and 1.5
// scaling, where a Windows user lands exactly on Tailwind's `2xl` and `xl`
// edges — and neither this list nor ux-review's covers them. Matching the
// bundle is what makes the two comparable; a scaling row is a second
// capture, at a deviceScaleFactor this one doesn't vary either.
const BREAKPOINTS: Breakpoint[] = [
	{ id: "desktop", label: "Desktop", width: 1440, height: 900 },
	{ id: "mobile", label: "Mobile", width: 390, height: 844 },
];

export interface CaptureOpts {
	baseUrl: string;
	outDir: string;
	os: string;
	// Cloudflare Access service-token headers, for the staging default —
	// null when capturing an origin that isn't gated.
	accessHeaders: Record<string, string> | null;
}

// One full-page shot. Returns the manifest record; the JPEG, when there is
// one, comes back beside it for the caller to write.
async function capturePage(
	page: Page,
	baseUrl: string,
	bp: Breakpoint,
	spec: PageSpec,
): Promise<{ shot: OsShot; buf?: Buffer }> {
	const base: OsShot = { pageId: spec.id, bpId: bp.id };
	const resp = await page.goto(`${baseUrl}${spec.route}`, {
		waitUntil: "load",
	});
	if (!resp || !resp.ok()) {
		return {
			shot: {
				...base,
				error:
					resp && resp.status() === 404
						? "status 404 — this origin's data doesn't hold the subject. " +
							"Staging's D1/R2 is a hand-made clone (`./per-ankh staging " +
							"reclone`), so a page prod serves can be missing here."
						: `status ${resp ? resp.status() : "none"}`,
			},
		};
	}

	// Two redirects that answer 200 and would otherwise be screenshotted as
	// if they were the page: the app's own sign-in gate (`/?next=…`), and
	// Cloudflare Access bouncing an untokened request to its login, which
	// leaves the origin entirely. Anything else is a normal redirect and goes
	// into the manifest as `landed` — see PAGES on the profile permalink.
	const landedUrl = new URL(page.url());
	if (landedUrl.origin !== new URL(baseUrl).origin) {
		return {
			shot: {
				...base,
				error:
					`left the origin for ${landedUrl.origin} — ` +
					"Cloudflare Access gate, with no service token?",
			},
		};
	}
	const landed = landedUrl.pathname;
	if (landed === "/" && spec.route !== "/") {
		return {
			shot: {
				...base,
				error: "redirected to the landing page — is this page public?",
			},
		};
	}

	await settle(page);
	return {
		shot: {
			...base,
			file: `shots/${spec.id}__${bp.id}.jpg`,
			...(landed === spec.route ? {} : { landed }),
		},
		buf: await shoot(page),
	};
}

// Walk every breakpoint × page, write the shots, return the manifest.
export async function capture(opts: CaptureOpts): Promise<OsManifest> {
	const { baseUrl, outDir, os, accessHeaders } = opts;
	const shotsDir = path.join(outDir, "shots");
	// Clear `shots/` rather than the whole of `outDir`: a stale JPEG from a
	// previous run would otherwise be uploaded as this one's, and that is the
	// only thing here worth deleting. `--out` is whatever the flag holds, so a
	// recursive remove of it is a `rm -rf` on an unvalidated path — `--out src`
	// would have taken `src/` with it.
	await rm(shotsDir, { recursive: true, force: true });
	await mkdir(shotsDir, { recursive: true });

	const shots: OsShot[] = [];
	const browser = await chromium.launch({ headless: true });
	try {
		for (const bp of BREAKPOINTS) {
			info(`=== ${os} · ${bp.label} (${bp.width}×${bp.height}) ===`);
			// A fresh context per breakpoint, for the reason ux-review re-navigates
			// rather than resizing: components that pick a layout at mount don't
			// re-derive it when the viewport changes under them.
			const ctx = await browser.newContext({
				viewport: { width: bp.width, height: bp.height },
				deviceScaleFactor: 1,
				...(accessHeaders ? { extraHTTPHeaders: accessHeaders } : {}),
			});
			const page = await ctx.newPage();
			for (const spec of PAGES) {
				const { shot, buf } = await capturePage(page, baseUrl, bp, spec);
				if (buf && shot.file) {
					await writeFile(path.join(outDir, shot.file), buf);
					info(`  ${spec.title}${shot.landed ? ` → ${shot.landed}` : ""}`);
				} else {
					info(`  ${spec.title} — ${shot.error}`);
				}
				shots.push(shot);
			}
			await ctx.close();
		}
	} finally {
		await browser.close();
	}

	const manifest: OsManifest = {
		os,
		generatedAt: new Date().toISOString(),
		baseUrl,
		pages: PAGES,
		breakpoints: BREAKPOINTS,
		shots,
	};
	await writeFile(
		path.join(outDir, "manifest.json"),
		JSON.stringify(manifest, null, "\t") + "\n",
	);
	return manifest;
}
