// The zoom overlay both shot viewers embed: `./per-ankh ux-review`'s
// single-pane bundle and `./per-ankh screenshot compare`'s per-OS grid. Each
// renders a different layout around it — one stage, or a cell per OS — and
// both hand a thumbnail's `src` to the same overlay when it is clicked.
//
// It is shared because the hand-copy diverged and cost a feature: the grid's
// copy dropped the `fit` rules, so clicking a 1440×900 shot opened it at full
// size with no way to fit it to the window — the opposite of what the zoom is
// for when the thumbnail is already a third of the screen wide. Opens fit,
// clicks through to full size and back, closes on the backdrop or Escape.
//
// Three fragments rather than one string, because a viewer's HTML interleaves
// them: the rules join its `<style>`, the markup goes last in its `<body>`,
// and the script joins the same inline `<script>` that calls `openLightbox`.
// Not the app's own `FullscreenDialog` (`src/lib/ui`), which the screenshot
// gallery and the map view zoom through: these bundles are static files opened
// from disk with no build step, so what they can embed is a string.

// Rules for the `<style>` block, indented one tab to sit level with the
// viewer's own.
export const LIGHTBOX_CSS = `	#lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.92); display: none;
		overflow: auto; cursor: zoom-out; z-index: 10; }
	#lightbox.open { display: block; }
	#lightbox img { display: block; margin: 0 auto; }
	#lightbox img.fit { max-width: 100%; max-height: 100vh; cursor: zoom-in; }
	#lightbox img.full { max-width: none; cursor: zoom-out; }`;

// Last in `<body>`: a fixed overlay, hidden until `openLightbox` opens it.
export const LIGHTBOX_HTML = `<div id="lightbox"><img alt="" /></div>`;

// `openLightbox(src)` for the viewer's own click handlers to call, plus the
// handlers that close it. Escape is its own `keydown` listener, so a viewer
// that binds other keys keeps them in a listener of its own.
export const LIGHTBOX_JS = `function openLightbox(src) {
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
});`;
