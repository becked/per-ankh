// Shared types for the cross-OS screenshot bundle (`./per-ankh screenshot`).
// One manifest per runner; `compare` reads several and renders them as
// columns of one grid.

import type { Breakpoint } from "../lib/page-capture";

export type { Breakpoint };

// One surface the matrix is captured at. The list is fixed in capture.ts.
export interface OsPage {
	id: string;
	title: string;
	route: string;
}

// One (page × breakpoint) capture from one runner. Exactly one of `file` and
// `error` is set.
export interface OsShot {
	pageId: string;
	bpId: string;
	// Manifest-relative path to the JPEG.
	file?: string;
	error?: string;
	// Where the browser actually came to rest, when that isn't the path asked
	// for. A profile permalink answers 307 (see PAGES in capture.ts), so a
	// redirect is normal here and gets reported rather than treated as a miss.
	landed?: string;
}

// One runner's whole output: `<out>/manifest.json` beside `<out>/shots/`.
export interface OsManifest {
	// The OS as its runner names it — `RUNNER_OS` on GitHub Actions ("Linux",
	// "Windows", "macOS"), `process.platform` when run by hand.
	os: string;
	generatedAt: string;
	baseUrl: string;
	pages: OsPage[];
	breakpoints: Breakpoint[];
	shots: OsShot[];
}
