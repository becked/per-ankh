// The side-by-side page `./per-ankh screenshot compare` writes: one row per
// captured page, one column per OS, at the selected breakpoint.
//
// References each runner's `shots/` through its artifact directory rather
// than inlining anything, so the page sits next to the downloaded artifacts
// and stays a few KB. Inline JS/CSS is fine — a static file opened from disk,
// not served under the app's CSP.

import { escapeHtml } from "$lib/utils/formatting";

import { LIGHTBOX_CSS, LIGHTBOX_HTML, LIGHTBOX_JS } from "../lib/shot-lightbox";

import type { OsManifest } from "./types";

// One downloaded artifact: `dir` is its path relative to the rendered file,
// which is what the shot paths are prefixed with — so the page still finds
// the images when `--out` puts it outside the artifact directory.
export interface OsSource {
	dir: string;
	manifest: OsManifest;
}

// Column order, so Linux doesn't land between Windows and macOS because of
// how `gh run download` happened to name the directories. Anything not
// listed keeps its discovered order, after these.
const OS_ORDER = ["Linux", "Windows", "macOS"];

export function sortSources(sources: OsSource[]): OsSource[] {
	const rank = (os: string): number => {
		const i = OS_ORDER.indexOf(os);
		return i === -1 ? OS_ORDER.length : i;
	};
	return [...sources].sort((a, b) => rank(a.manifest.os) - rank(b.manifest.os));
}

export function renderComparisonHtml(sources: OsSource[]): string {
	const ordered = sortSources(sources);
	// Every runner walks the same hardcoded list, so the first manifest names
	// the rows and the breakpoint tabs; a column missing one of them renders
	// as an empty cell rather than dropping the row.
	const { pages, breakpoints, baseUrl } = ordered[0].manifest;
	const data = JSON.stringify({
		pages,
		breakpoints,
		columns: ordered.map((s) => ({
			os: s.manifest.os,
			dir: s.dir,
			generatedAt: s.manifest.generatedAt,
			shots: s.manifest.shots,
		})),
	});

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Per-Ankh — OS screenshots</title>
<style>
	:root { color-scheme: dark; }
	* { box-sizing: border-box; }
	body { margin: 0; font: 14px/1.5 system-ui, -apple-system, sans-serif;
		background: #1c1916; color: #e7ddcf; padding: 1.25rem 1.5rem 4rem; }
	h1 { font-size: 1.1rem; margin: 0 0 .25rem; }
	.meta { font-size: .78rem; color: #a99c87; margin-bottom: 1rem; line-height: 1.5; }
	.meta code { color: #cdbfa8; }
	#bps { display: flex; gap: .4rem; margin-bottom: 1.25rem; }
	#bps button { font-size: .78rem; color: #e7ddcf; background: #241f1b;
		border: 1px solid #4a423a; border-radius: 4px; padding: .2rem .6rem; cursor: pointer; }
	#bps button.active { background: #6b5d4a; border-color: #6b5d4a; color: #fff; }
	section { margin-bottom: 2rem; }
	section > h2 { font-size: .95rem; margin: 0 0 .1rem; }
	section > .route { font-size: .78rem; color: #a99c87; margin-bottom: .5rem; }
	.row { display: grid; gap: .75rem; align-items: start; }
	.cell > .os { font-size: .78rem; font-weight: 700; color: #f0e7d8; margin-bottom: .25rem;
		border-bottom: 1px solid #4a423a; padding-bottom: .2rem; }
	.cell > .os .landed { font-weight: 400; color: #a99c87; }
	.cell img { width: 100%; height: auto; display: block; border: 1px solid #000;
		border-radius: 6px; background: #000; cursor: zoom-in; }
	.cell .err { color: #ffb4a8; font-size: .8rem; padding: .75rem; border: 1px solid #5a2b25;
		border-radius: 6px; background: #2a1714; }
${LIGHTBOX_CSS}
</style>
</head>
<body>
<h1>OS screenshots</h1>
<div class="meta">
	Captured against <code>${escapeHtml(baseUrl)}</code> ·
	${ordered
		.map(
			(s) =>
				`${escapeHtml(s.manifest.os)} ${escapeHtml(s.manifest.generatedAt)}`,
		)
		.join(" · ")}
	<br />Click a shot to zoom, again for full size. The UI face is shipped, so what differs
	per OS is rasterization and the chrome the platform paints itself —
	issue #295.
</div>
<div id="bps"></div>
<div id="grid"></div>
${LIGHTBOX_HTML}
<script>
const DATA = ${data};
let curBp = DATA.breakpoints[0].id;

function shotFor(col, pageId, bpId) {
	return col.shots.find((s) => s.pageId === pageId && s.bpId === bpId);
}

function buildBps() {
	const bps = document.getElementById("bps");
	bps.innerHTML = "";
	for (const b of DATA.breakpoints) {
		const btn = document.createElement("button");
		btn.textContent = b.label + " · " + b.width;
		btn.classList.toggle("active", b.id === curBp);
		btn.onclick = () => { curBp = b.id; buildBps(); render(); };
		bps.appendChild(btn);
	}
}

function render() {
	const grid = document.getElementById("grid");
	grid.innerHTML = "";
	for (const page of DATA.pages) {
		const sec = document.createElement("section");
		const h = document.createElement("h2");
		h.textContent = page.title;
		const route = document.createElement("div");
		route.className = "route";
		route.textContent = page.route;
		const row = document.createElement("div");
		row.className = "row";
		row.style.gridTemplateColumns = "repeat(" + DATA.columns.length + ", 1fr)";
		for (const col of DATA.columns) {
			const cell = document.createElement("div");
			cell.className = "cell";
			const shot = shotFor(col, page.id, curBp);
			const label = document.createElement("div");
			label.className = "os";
			label.textContent = col.os;
			if (shot && shot.landed) {
				const l = document.createElement("span");
				l.className = "landed";
				l.textContent = " → " + shot.landed;
				label.appendChild(l);
			}
			cell.appendChild(label);
			if (shot && shot.file) {
				const img = document.createElement("img");
				img.src = col.dir + "/" + shot.file;
				img.alt = col.os + " " + page.title + " " + curBp;
				img.onclick = () => openLightbox(img.src);
				cell.appendChild(img);
			} else {
				const e = document.createElement("div");
				e.className = "err";
				e.textContent = "⚠ " + ((shot && shot.error) || "no capture");
				cell.appendChild(e);
			}
			row.appendChild(cell);
		}
		sec.appendChild(h);
		sec.appendChild(route);
		sec.appendChild(row);
		grid.appendChild(sec);
	}
}

${LIGHTBOX_JS}

buildBps(); render();
</script>
</body>
</html>
`;
}
