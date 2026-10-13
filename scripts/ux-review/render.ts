// Bundle emission: the human/agent README and the single-pane HTML viewer.
// Both read the same {meta, screens} the manifest is built from.

import { escapeHtml } from "$lib/utils/formatting";

import type { ReviewMeta, Screen } from "./types";

const PASS_LABELS = {
	anon: "Anonymous (signed out)",
	auth: (label: string): string => `Signed in (${label})`,
};

const PAGE_LABELS: Record<string, string> = {
	home: "Home",
	"game-detail": "Game detail",
	"game-map": "Map view",
	"game-screenshots": "Screenshots view",
	"user-profile": "User profile",
	account: "Account",
	tournaments: "Tournaments",
	"tournament-detail": "Tournament detail",
	admin: "Admin",
	redirects: "Redirect routes",
};

interface Bundle {
	meta: ReviewMeta;
	screens: Screen[];
}

// README.md — human index + Claude-reviewer brief.
export function renderReadme({ meta, screens }: Bundle): string {
	const lines: string[] = [];
	lines.push("# Per-Ankh — UX Review Bundle\n");
	lines.push(
		`Generated **${meta.generatedAt}** against \`${meta.baseUrl}\` · ` +
			`game \`${meta.ids.gameId}\` · public user \`${meta.ids.userId}\` · ` +
			`signed in as \`${meta.ids.authUserId}\`` +
			(meta.ids.authLabel ? ` (${meta.ids.authLabel})` : "") +
			(meta.ids.screenshotGameId
				? ` · screenshots view on game \`${meta.ids.screenshotGameId}\``
				: "") +
			".\n",
	);
	lines.push("## How to review\n");
	lines.push(
		"- **Humans:** open `index.html` — sidebar nav tree, breakpoint " +
			"switcher, click any shot to zoom.\n" +
			"- **Claude Code:** start from `manifest.json` for the full inventory " +
			"(route + state + breakpoint paths per screen), then Read only the " +
			"`shots/*.jpg` you need. Filenames are " +
			"`{pass}__{page}[__{tab}]__{breakpoint}.jpg`, so you can glob — e.g. " +
			"`shots/auth__*__mobile.jpg` for every signed-in screen on mobile.\n",
	);
	lines.push("## What to look for\n");
	lines.push(
		"- Layout integrity at each breakpoint (overflow, clipping, tap-target " +
			"size on mobile).\n" +
			"- State differences: anonymous vs. owner views of the same page " +
			"(controls that should/shouldn't appear).\n" +
			"- Consistency of headers, tables, and charts against the games-table " +
			"theme.\n" +
			"- Empty/edge states and any visibly broken renders.\n" +
			"- Cold-start home: the `Cold feed` / `Cold start` shots stub the " +
			"home feeds empty, so the games column widens to two-up cards and " +
			"the hero loses its video tile — layouts the live feed never shows.\n",
	);
	lines.push(
		`## Inventory\n\nBreakpoints: ${meta.breakpoints
			.map((b) => `${b.label} (${b.width}×${b.height})`)
			.join(", ")}.\n`,
	);

	let lastPass: string | null = null;
	let lastPage: string | null = null;
	for (const s of screens) {
		if (s.pass !== lastPass) {
			const label =
				s.pass === "auth"
					? PASS_LABELS.auth(meta.ids.authLabel || meta.ids.authUserId)
					: PASS_LABELS.anon;
			lines.push(`\n### ${label}\n`);
			lastPass = s.pass;
			lastPage = null;
		}
		if (s.page !== lastPage) {
			lines.push(`\n**${PAGE_LABELS[s.page] ?? s.page}** — \`${s.route}\`\n`);
			lastPage = s.page;
		}
		const name = s.title;
		if (s.note) {
			lines.push(`- ${name} — verification only:`);
			for (const ln of s.note.split("\n")) lines.push(`  - \`${ln}\``);
		} else {
			const shotLinks = meta.breakpoints
				.map((b) =>
					s.shots[b.id]
						? `[${b.label}](${s.shots[b.id]})`
						: `~~${b.label}~~ (${s.errors[b.id] ? "error" : "missing"})`,
				)
				.join(" · ");
			lines.push(`- ${name}: ${shotLinks}`);
		}
	}
	return lines.join("\n") + "\n";
}

// index.html — single-pane viewer. Tree + breakpoint sub-tabs + lightbox.
// References ./shots/ rather than inlining. Inline JS/CSS is fine — a static
// file opened from disk, not served under the app's CSP.
export function renderIndexHtml({ meta, screens }: Bundle): string {
	const data = JSON.stringify({ breakpoints: meta.breakpoints, screens });
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Per-Ankh — UX Review</title>
<style>
	:root { color-scheme: dark; }
	* { box-sizing: border-box; }
	body { margin: 0; font: 14px/1.5 system-ui, -apple-system, sans-serif;
		background: #1c1916; color: #e7ddcf; display: flex; height: 100vh; overflow: hidden; }
	#sidebar { width: 280px; flex: none; overflow-y: auto; background: #15120f;
		border-right: 1px solid #000; padding: .75rem; }
	#sidebar h1 { font-size: 1rem; margin: 0 0 .25rem; }
	#sidebar .meta { font-size: .72rem; color: #a99c87; margin-bottom: .75rem; line-height: 1.4; }
	.group { font-size: .8rem; font-weight: 700; color: #f0e7d8; text-transform: uppercase;
		letter-spacing: .04em; margin: 1rem 0 .35rem; border-bottom: 1px solid #4a423a; padding-bottom: .2rem; }
	.page-grp { margin: .25rem 0; }
	.page-grp > summary { cursor: pointer; font-weight: 600; color: #cdbfa8; padding: .2rem .25rem;
		list-style: none; font-size: .82rem; }
	.page-grp > summary::-webkit-details-marker { display: none; }
	.page-grp > summary:hover { color: #fff; }
	.leaf { display: block; width: 100%; text-align: left; background: none; border: none;
		color: #cdbfa8; padding: .2rem .25rem .2rem 1.1rem; font-size: .8rem; cursor: pointer;
		border-radius: 4px; }
	.leaf:hover { background: #2a2622; color: #fff; }
	.leaf.active { background: #3a322a; color: #fff; }
	.leaf.err { color: #ffb4a8; }
	#main { flex: 1; overflow-y: auto; padding: 1.25rem 1.5rem; }
	#hdr h2 { margin: 0 0 .15rem; font-size: 1.1rem; }
	#hdr .route { color: #a99c87; font-size: .82rem; }
	#hdr .state { display: inline-block; margin-left: .5rem; font-size: .7rem; padding: .05rem .4rem;
		border: 1px solid #4a423a; border-radius: 3px; color: #b9ad97; }
	#bps { margin: .75rem 0; display: flex; gap: .4rem; }
	#bps button { font-size: .78rem; color: #e7ddcf; background: #241f1b; border: 1px solid #4a423a;
		border-radius: 4px; padding: .2rem .6rem; cursor: pointer; }
	#bps button.active { background: #6b5d4a; border-color: #6b5d4a; color: #fff; }
	#bps button:disabled { opacity: .35; cursor: default; }
	#stage img { max-width: 100%; height: auto; display: block; border: 1px solid #000;
		border-radius: 6px; background: #000; cursor: zoom-in; }
	#stage .err { color: #ffb4a8; padding: .75rem; border: 1px solid #5a2b25; border-radius: 6px;
		background: #2a1714; }
	#stage pre.redir { font-size: .82rem; color: #b9ad97; padding: .75rem; margin: 0;
		border: 1px solid #4a423a; border-radius: 6px; background: #221e1a; white-space: pre-wrap; }
	#lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.92); display: none;
		overflow: auto; cursor: zoom-out; z-index: 10; }
	#lightbox.open { display: block; }
	#lightbox img { display: block; margin: 0 auto; }
	#lightbox img.fit { max-width: 100%; max-height: 100vh; cursor: zoom-in; }
	#lightbox img.full { max-width: none; cursor: zoom-out; }
</style>
</head>
<body>
<aside id="sidebar">
	<h1>UX Review</h1>
	<div class="meta">
		${escapeHtml(meta.generatedAt)}<br />
		base ${escapeHtml(meta.baseUrl)}<br />
		signed in as <code>${escapeHtml(meta.ids.authLabel || meta.ids.authUserId)}</code>
	</div>
	<nav id="tree"></nav>
</aside>
<main id="main">
	<div id="hdr"></div>
	<div id="bps"></div>
	<div id="stage"></div>
</main>
<div id="lightbox"><img alt="" /></div>
<script>
const DATA = ${data};
const PASS_LABEL = {
	anon: "Anonymous (signed out)",
	auth: ${JSON.stringify(
		PASS_LABELS.auth(meta.ids.authLabel || meta.ids.authUserId),
	)},
};
const PAGE_LABEL = ${JSON.stringify(PAGE_LABELS)};
const order = DATA.screens.map((s) => s.id);
let curId = order[0];
let curBp = DATA.breakpoints[0].id;

function byId(id) { return DATA.screens.find((s) => s.id === id); }

function buildTree() {
	const tree = document.getElementById("tree");
	let passEl = null, pageEl = null, lastPass = null, lastPage = null;
	for (const s of DATA.screens) {
		if (s.pass !== lastPass) {
			const h = document.createElement("div");
			h.className = "group"; h.textContent = PASS_LABEL[s.pass] || s.pass;
			tree.appendChild(h); lastPass = s.pass; lastPage = null;
		}
		if (s.page !== lastPage) {
			pageEl = document.createElement("details");
			pageEl.className = "page-grp"; pageEl.open = true;
			const sum = document.createElement("summary");
			sum.textContent = PAGE_LABEL[s.page] || s.page;
			pageEl.appendChild(sum); tree.appendChild(pageEl); lastPage = s.page;
		}
		const btn = document.createElement("button");
		btn.className = "leaf"; btn.dataset.id = s.id;
		btn.textContent = s.tab || (PAGE_LABEL[s.page] || s.page);
		const hasShot = s.shots && Object.keys(s.shots).length > 0;
		if (!hasShot && !s.note) btn.classList.add("err");
		btn.onclick = () => select(s.id);
		pageEl.appendChild(btn);
	}
}

function render() {
	const s = byId(curId);
	document.querySelectorAll(".leaf").forEach((b) =>
		b.classList.toggle("active", b.dataset.id === curId));
	const hdr = document.getElementById("hdr");
	hdr.innerHTML = '<h2>' + esc(PAGE_LABEL[s.page] || s.page) +
		(s.tab ? ' · ' + esc(s.tab) : '') + '</h2>' +
		'<span class="route">' + esc(s.route) + '</span>' +
		'<span class="state">' + esc(s.state) + '</span>';

	const bps = document.getElementById("bps");
	bps.innerHTML = "";
	if (s.note) { bps.style.display = "none"; } else {
		bps.style.display = "flex";
		for (const b of DATA.breakpoints) {
			const has = s.shots && s.shots[b.id];
			const btn = document.createElement("button");
			btn.textContent = b.label + " · " + b.width;
			btn.disabled = !has;
			btn.classList.toggle("active", b.id === curBp);
			btn.onclick = () => { curBp = b.id; render(); };
			bps.appendChild(btn);
		}
	}

	const stage = document.getElementById("stage");
	if (s.note) {
		stage.innerHTML = '<pre class="redir">' + esc(s.note) + '</pre>';
	} else if (s.shots && s.shots[curBp]) {
		const img = document.createElement("img");
		img.src = s.shots[curBp]; img.alt = s.id + " " + curBp;
		img.onclick = () => openLightbox(s.shots[curBp]);
		stage.innerHTML = ""; stage.appendChild(img);
	} else {
		const msg = (s.errors && s.errors[curBp]) || "No capture at this breakpoint.";
		stage.innerHTML = '<div class="err">⚠ ' + esc(msg) + '</div>';
	}
}

function select(id) {
	curId = id;
	const s = byId(id);
	if (!(s.shots && s.shots[curBp])) {
		const first = s.shots && Object.keys(s.shots)[0];
		if (first) curBp = first;
	}
	render();
}

function openLightbox(src) {
	const lb = document.getElementById("lightbox");
	const img = lb.querySelector("img");
	img.src = src; img.className = "fit";
	lb.classList.add("open");
}
document.getElementById("lightbox").onclick = (e) => {
	if (e.target.tagName === "IMG") { e.target.classList.toggle("fit"); e.target.classList.toggle("full"); }
	else document.getElementById("lightbox").classList.remove("open");
};
document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") document.getElementById("lightbox").classList.remove("open");
	if (e.key === "ArrowDown" || e.key === "ArrowUp") {
		const i = order.indexOf(curId);
		const ni = e.key === "ArrowDown" ? Math.min(order.length - 1, i + 1) : Math.max(0, i - 1);
		select(order[ni]); e.preventDefault();
	}
});
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
buildTree(); render();
</script>
</body>
</html>
`;
}
