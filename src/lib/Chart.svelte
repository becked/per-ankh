<script lang="ts">
  import { onMount, tick } from "svelte";
  import * as echarts from "echarts";
  import type { EChartsOption } from "echarts";

  let { option, height = "400px" }: { option: EChartsOption; height?: string } = $props();

  let chartContainer: HTMLDivElement;
  let chart: echarts.ECharts | null = null;

  onMount(async () => {
    // Wait for DOM to be fully rendered
    await tick();

    const initChart = () => {
      if (!chartContainer) return;

      // Check if container has dimensions
      const { clientWidth, clientHeight } = chartContainer;
      if (clientWidth === 0 || clientHeight === 0) {
        return;
      }

      // Initialize chart if not already done
      if (!chart) {
        chart = echarts.init(chartContainer);
        chart.setOption(option as any);
      }
    };

    // Try initial initialization
    initChart();

    // Use ResizeObserver to detect when container gets dimensions
    const resizeObserver = new ResizeObserver(() => {
      if (!chart && chartContainer) {
        // Container now has dimensions, try to initialize
        initChart();
      }
      // Resize existing chart
      chart?.resize();
    });

    resizeObserver.observe(chartContainer);

    // Also listen for window resize
    const handleResize = () => chart?.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      chart?.dispose();
    };
  });

  $effect(() => {
    if (chart) {
      // Type assertion needed due to echarts type definition incompatibility
      chart.setOption(option as any, true);
      // Force resize to handle tab visibility changes
      chart.resize();
    }
  });
</script>

<div class="w-full" style="height: {height}">
  <div bind:this={chartContainer} class="w-full h-full"></div>
</div>
