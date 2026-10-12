// Playwright capture primitives shared by the screenshot commands —
// `./per-ankh ux-review` (local, discovery-driven) and `./per-ankh screenshot`
// (one runner per OS, fixed page list). Both drive the same app through the
// same two steps after a navigation, settle then encode, so the waits and the
// JPEG quality live here rather than drifting apart in each command.

import sharp from "sharp";
import type { Page } from "playwright";

// A viewport a walkthrough is replayed at. `id` is the filename suffix and
// the manifest key; `label` is what a viewer shows.
export interface Breakpoint {
	id: string;
	label: string;
	width: number;
	height: number;
}

export const JPEG_QUALITY = 72;

// Settle async client rendering (ECharts, deck.gl map) after a navigation or
// tab switch. We can't wait on full "networkidle" — external avatar images
// (Discord CDN) keep the connection pool busy indefinitely — so cap the idle
// wait and add a fixed render settle.
export async function settle(page: Page): Promise<void> {
	await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
	await page.waitForTimeout(900);
	await page.evaluate(() => window.scrollTo(0, 0));
}

// Capture the current page and return a JPEG buffer. `fullPage` yields the
// viewport rather than the document here: the app scrolls in inner containers
// under a `height: 100%; overflow: hidden` body (src/app.css), so there is no
// document below the fold for it to extend into.
export async function shoot(page: Page): Promise<Buffer> {
	const png = await page.screenshot({ type: "png", fullPage: true });
	return sharp(png).jpeg({ quality: JPEG_QUALITY }).toBuffer();
}
