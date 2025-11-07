<script lang="ts">
  import { onMount } from "svelte";
  import * as echarts from "echarts";
  import type { EChartsOption } from "echarts";

  let { option, height = "400px" }: { option: EChartsOption; height?: string } = $props();

  let chartContainer: HTMLDivElement;
  let chart: echarts.ECharts | null = null;

  onMount(() => {
    // Wait for container to have dimensions before initializing
    const initChart = () => {
      if (chartContainer.clientWidth === 0 || chartContainer.clientHeight === 0) {
        // Container not ready yet, try again soon
        setTimeout(initChart, 50);
        return;
      }

      chart = echarts.init(chartContainer);
      // Type assertion needed due to echarts type definition incompatibility
      chart.setOption(option as any);
    };

    initChart();

    const handleResize = () => chart?.resize();
    window.addEventListener("resize", handleResize);

    return () => {
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
