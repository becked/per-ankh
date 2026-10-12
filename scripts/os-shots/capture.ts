// Per-runner capture for `./per-ankh os-shots capture`: one signed-out pass
// over a fixed page list at two viewports, writing `<out>/shots/*.jpg` and
// `<out>/manifest.json`. The OS screenshots workflow runs this once per
// runner and uploads the directory as that OS's artifact.
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

import { info } from "../lib/format";
import { settle, shoot } from "../lib/page-capture";
import type { Breakpoint, OsManifest, OsPage, OsShot } from "./types";

export const DEFAULT_BASE_URL = "https://staging.per-ankh.app";

// The three surfaces this matrix exists to compare.
//
// The profile is `/users/<user_id>`, not `/u/becked`: a released slug is
// immediately claimable by anyone, so `/u/<name>` can come to point at a
// different person, while `/users/<user_id>` is the permalink that never
// moves (docs/api-reference.md, "Profile slugs"). The permalink costs one
// 307 to the slug route, which `capturePage` records instead of failing on.
const PAGES: OsPage[] = [
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
];

// Desktop and mobile at ux-review's own dimensions, so a shot here reads
// against the bundle in docs/ux-review. Its middle (tablet, 768) breakpoint
// is dropped: what differs between these runners is which face the system
// font stack in src/app.css resolves to, and the metrics that follow bite
// hardest at the narrow end — a third width mostly repeats whichever of the
// two it sits between.
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
	spec: OsPage,
): Promise<{ shot: OsShot; buf?: Buffer }> {
	const base: OsShot = { pageId: spec.id, bpId: bp.id };
	const expectedPath = spec.route.split("?")[0];
	const resp = await page.goto(`${baseUrl}${spec.route}`, {
		waitUntil: "load",
	});
	if (!resp || !resp.ok()) {
		return {
			shot: {
				...base,
				error: `status ${resp ? resp.status() : "none"}`,
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
	if (landed === "/" && expectedPath !== "/") {
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
			...(landed === expectedPath ? {} : { landed }),
		},
		buf: await shoot(page),
	};
}

// Walk every breakpoint × page, write the shots, return the manifest.
export async function captureOs(opts: CaptureOpts): Promise<OsManifest> {
	const { baseUrl, outDir, os, accessHeaders } = opts;
	const shotsDir = path.join(outDir, "shots");
	await rm(outDir, { recursive: true, force: true });
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
