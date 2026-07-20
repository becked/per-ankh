<script module lang="ts">
	import { registerTheme } from "$lib/echarts";

	// Register once: ECharts' default axis-label color is a grey that's hard to
	// read on our dark background, so default every axis's labels to white. The
	// rest of the styling comes from CHART_THEME spread into each option.
	const AXIS_LABEL = { axisLabel: { color: "#FFFFFF" } };
	registerTheme("perankh", {
		categoryAxis: AXIS_LABEL,
		valueAxis: AXIS_LABEL,
		logAxis: AXIS_LABEL,
		timeAxis: AXIS_LABEL,
	});
</script>

<script lang="ts">
	import { onMount, tick, untrack } from "svelte";
	import { init } from "$lib/echarts";
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

	onMount(() => {
		let resizeObserver: ResizeObserver;

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
			chart.setOption(currentOption, true);
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
</script>

<div class="w-full" style="height: {height}">
	<div bind:this={chartContainer} class="h-full w-full"></div>
</div>
