<script lang="ts">
  import { onMount } from "svelte";
  import * as echarts from "echarts";
  import type { EChartsOption } from "echarts";

  let { option, height = "400px" }: { option: EChartsOption; height?: string } = $props();

  let chartContainer: HTMLDivElement;
  let chart: echarts.ECharts;

  onMount(() => {
    chart = echarts.init(chartContainer);
    chart.setOption(option);

    const handleResize = () => chart.resize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.dispose();
    };
  });

  $effect(() => {
    if (chart) {
      chart.setOption(option, true);
    }
  });
</script>

<div class="w-full" style="height: {height}">
  <div bind:this={chartContainer} class="w-full h-full"></div>
</div>
