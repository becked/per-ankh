<script module lang="ts">
	import { registerTheme } from "$lib/echarts";
	import { TOOLTIP_BORDER, TOOLTIP_SURFACE, TOOLTIP_TEXT } from "$lib/config";

	// Register once: ECharts' default axis-label color is a grey that's hard to
	// read on our dark background, so default every axis's labels to white. The
	// rest of the styling comes from CHART_THEME spread into each option, bar
	// the tooltip below.
	const AXIS_LABEL = { axisLabel: { color: "#FFFFFF" } };
	registerTheme("perankh", {
		categoryAxis: AXIS_LABEL,
		valueAxis: AXIS_LABEL,
		logAxis: AXIS_LABEL,
		timeAxis: AXIS_LABEL,
		// The tooltip is the one surface CHART_THEME can't carry: a chart that
		// writes its own `tooltip` object replaces the spread wholesale, and the
		// oldest, most-looked-at plots (Military Power, the yield bands) all do.
		// Theme values instead merge *under* the option — `mergeDefaultAndTheme`
		// runs `merge(option, theme)` with no overwrite flag
		// (node_modules/echarts/lib/model/Component.js) — so these fill in only
		// the keys a call site left unset, reaching every chart either way.
		//
		// The three keys move together. ECharts' default text shade is a mid
		// grey picked to read on its own white box, so a dark background without
		// it is grey on near-black; and v6 paints the border in the *nearest
		// point's* series color unless `borderColor` is set, appending it after
		// everything else (`TooltipHTMLContent.show`).
		tooltip: {
			backgroundColor: TOOLTIP_SURFACE,
			borderColor: TOOLTIP_BORDER,
			textStyle: { color: TOOLTIP_TEXT },
		},
	});
</script>

<script lang="ts">
	import { onMount, tick, untrack } from "svelte";
	import { init } from "$lib/echarts";
	import { CHART_FONT_PROBE } from "$lib/config";
	import type { ChartOption, ECElementEvent, ECharts } from "$lib/echarts";

	let {
		option,
		height = "400px",
		onItemClick,
		onReady,
		onLayout,
	}: {
		option: ChartOption;
		height?: string;
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onItemClick?: (params: ECElementEvent) => void;
		// Fired once with the ECharts instance (approach-B overlays use it to map
		// data values to plot pixels via convertToPixel).
		// eslint-disable-next-line no-unused-vars -- parameter in callback signature
		onReady?: (chart: ECharts) => void;
		// Fired whenever the chart (re-)lays out — init, option change, resize — so
		// a parent can recompute DOM positions that track the plot.
		onLayout?: () => void;
	} = $props();

	let chartContainer: HTMLDivElement;
	let chart: ECharts | null = null;

	// ECharts rasterizes axis and label text into the canvas as it draws and
	// never redraws it when a webfont arrives later, so a chart that painted
	// inside the font-swap window would keep fallback-font labels until the
	// next resize or data change. Awaiting the font before the first draw
	// would give that back the latency the instant-paint pass bought
	// (CHART_THEME keeps `animation: false` so a chart paints on arrival), so
	// instead: paint now, and flip this once the face lands to redraw in the
	// new face (the font effect below). Stays false if the font never loads —
	// there is nothing to redraw for.
	//
	// That redraw restores the glyphs, not the measurements. zrender caches
	// text metrics in a module-level LRU keyed by the font shorthand
	// (`ensureFontMeasureInfo`, node_modules/zrender/lib/contain/text.js:7),
	// and the shorthand doesn't change when the face lands — so ellipsis,
	// label rotation and `containLabel` padding keep the widths measured in
	// the fallback, and because the cache is module-level one chart that
	// mounted early holds them for every chart mounted after it. The preload
	// in src/app.html is what keeps that window shut; this flip is the
	// backstop for a cold load slow enough to miss it.
	let fontReady = $state(false);

	// How long an in-place data change takes to animate. CHART_THEME keeps
	// `animation: false` so a chart still paints instantly on arrival — that is
	// what the skeleton/instant-paint pass bought — but a chart already on
	// screen swapping its data is a different moment: an instant swap there
	// reads as a glitch rather than as speed. So animation is turned on for the
	// update path below only, and the initial setOption keeps the theme's value.
	//
	// Shorter than ECharts' 1s default, which reads as sluggish beside the app's
	// 200ms view crossfades, and long enough to be followed.
	const UPDATE_ANIMATION_MS = 400;

	onMount(() => {
		let resizeObserver: ResizeObserver;

		if (document.fonts.check(CHART_FONT_PROBE)) {
			fontReady = true;
		} else {
			// Rejects if the face fails to fetch or parse. Swallowed: the
			// fallback stack has already painted a correct chart, so there is
			// no redraw to schedule and nothing for a caller to recover from.
			void document.fonts
				.load(CHART_FONT_PROBE)
				.then(() => {
					fontReady = true;
				})
				.catch(() => {});
		}

		const initChart = () => {
			if (!chartContainer) return;

			// Check if container has dimensions
			const { clientWidth, clientHeight } = chartContainer;
			if (clientWidth === 0 || clientHeight === 0) {
				return;
			}

			// Initialize chart if not already done
			if (!chart) {
				chart = init(chartContainer, "perankh");
				chart.setOption(option);
				// Read onItemClick at click time so prop updates take effect
				// without needing to rebind the listener.
				chart.on("click", (params) => {
					onItemClick?.(params as ECElementEvent);
				});
				onReady?.(chart);
				onLayout?.();
			}
		};

		// Initialize after tick to ensure DOM is ready
		tick().then(() => {
			// Try initial initialization
			initChart();

			// Use ResizeObserver to detect when container gets dimensions
			resizeObserver = new ResizeObserver(() => {
				if (!chart && chartContainer) {
					// Container now has dimensions, try to initialize
					initChart();
				}
				// Resize existing chart
				chart?.resize();
				if (chart) onLayout?.();
			});

			resizeObserver.observe(chartContainer);
		});

		// Also listen for window resize
		const handleResize = () => chart?.resize();
		window.addEventListener("resize", handleResize);

		return () => {
			resizeObserver?.disconnect();
			window.removeEventListener("resize", handleResize);
			chart?.dispose();
		};
	});

	$effect(() => {
		// Access option unconditionally to ensure it's always tracked as a dependency.
		// Svelte 5 $effect only tracks dependencies at the point they're accessed,
		// so accessing option inside a conditional (if chart) would fail to track it
		// when chart is initially null. See CLAUDE.md "Effect Dependency Tracking".
		const currentOption = option;
		if (chart && currentOption) {
			chart.setOption(
				{
					...currentOption,
					animation: true,
					animationDuration: UPDATE_ANIMATION_MS,
				},
				true,
			);
			// Force resize to handle tab visibility changes
			chart.resize();
			// untrack: the notify must not add the callback prop (or anything the
			// handler touches) to this effect's dependencies. A parent's inline
			// `onLayout` handler is recreated whenever its fragment re-renders —
			// e.g. from the layout-tick state the handler itself bumps — so a
			// tracked call re-runs this effect and loops (setOption → onLayout →
			// tick++ → new handler → setOption …: effect_update_depth_exceeded).
			untrack(() => onLayout?.());
		}
	});

	// The face landing is a repaint, not a data change, so it takes the resize
	// path rather than the option effect above: `resize` runs ECharts' update
	// with `animation: {duration: 0}` even when the dimensions are unchanged
	// (`ECharts.prototype.resize`, node_modules/echarts/lib/core/echarts.js:964),
	// which re-rasterizes the labels without replaying the entry animation the
	// option effect reserves for a data swap and without notMerge resetting
	// chart state. On the first run `chart` is still null (onMount's tick
	// hasn't resolved), so a font that was already cached no-ops here and
	// initChart draws with it.
	$effect(() => {
		if (fontReady) {
			chart?.resize();
			// untrack for the same reason as the option effect above.
			untrack(() => onLayout?.());
		}
	});
</script>

<div class="w-full" style="height: {height}">
	<div bind:this={chartContainer} class="h-full w-full"></div>
</div>
