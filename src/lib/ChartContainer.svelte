<script lang="ts">
  import { onMount } from "svelte";
  import type { EChartsOption } from "echarts";
  import Chart from "$lib/Chart.svelte";

  let {
    option,
    height = "400px",
    title = "Chart",
  }: {
    // Using a broader type because ECharts types are overly strict
    // and don't play well with TypeScript's inference
    option: EChartsOption | Record<string, unknown>;
    height?: string;
    title?: string;
  } = $props();

  let isFullscreen = $state(false);

  function openFullscreen() {
    isFullscreen = true;
  }

  function closeFullscreen() {
    isFullscreen = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && isFullscreen) {
      closeFullscreen();
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    // Only close if clicking the backdrop itself, not the chart
    if (event.target === event.currentTarget) {
      closeFullscreen();
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("keydown", handleKeydown);
    };
  });
</script>

<!-- Normal view -->
<div class="relative p-1 border-2 border-tan rounded-lg mb-6" style="background-color: var(--color-chart-frame)">
  <!-- Expand button -->
  <button
    onclick={openFullscreen}
    class="absolute top-3 right-3 z-10 p-1.5 rounded bg-black/20 hover:bg-black/40 transition-colors"
    aria-label="Expand {title} to fullscreen"
    title="Expand to fullscreen"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      class="h-4 w-4 text-white"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
      />
    </svg>
  </button>

  <Chart {option} {height} />
</div>

<!-- Fullscreen overlay -->
{#if isFullscreen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-8"
    onclick={handleBackdropClick}
  >
    <div class="relative w-full h-full max-w-[95vw] max-h-[90vh] p-1 rounded-lg" style="background-color: var(--color-chart-frame)">
      <!-- Close button -->
      <button
        onclick={closeFullscreen}
        class="absolute top-4 right-4 z-10 p-2 rounded bg-black/30 hover:bg-black/50 transition-colors"
        aria-label="Close fullscreen"
        title="Close fullscreen (Esc)"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-5 w-5 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <Chart {option} height="100%" />
    </div>
  </div>
{/if}
