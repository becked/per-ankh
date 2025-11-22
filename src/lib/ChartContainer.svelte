<script lang="ts">
  import { type Snippet } from "svelte";
  import type { EChartsOption } from "echarts";
  import Chart from "$lib/Chart.svelte";

  let {
    option,
    height = "400px",
    title = "Chart",
    controls,
  }: {
    // Using a broader type because ECharts types are overly strict
    // and don't play well with TypeScript's inference
    option: EChartsOption | Record<string, unknown>;
    height?: string;
    title?: string;
    controls?: Snippet;
  } = $props();

  let dialogRef: HTMLDialogElement | null = $state(null);

  function openFullscreen() {
    dialogRef?.showModal();
  }

  function closeFullscreen() {
    dialogRef?.close();
  }

  function handleDialogClose() {
    // Remove focus from the button that triggered the dialog
    // to prevent the blue focus outline on the chart container
    // This handles all close methods: button click, Escape key, backdrop click
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    // Close if clicking the dialog backdrop (not the content)
    if (event.target === dialogRef) {
      closeFullscreen();
    }
  }
</script>

<!-- Normal view -->
<div class="mb-6">
  {#if controls}
    <div class="mb-4">
      {@render controls()}
    </div>
  {/if}
  <div class="relative p-1 border-2 border-tan rounded-lg" style="background-color: var(--color-chart-frame)">
    <!-- Expand button -->
    <button
      onclick={openFullscreen}
      class="absolute top-3 right-3 z-10 p-1.5 rounded bg-black/20 hover:bg-black/40 transition-colors cursor-pointer focus:outline-none"
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
</div>

<!-- Fullscreen dialog (renders in browser's top layer) -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogRef}
  onclick={handleBackdropClick}
  onclose={handleDialogClose}
  class="fullscreen-dialog"
>
  <div class="dialog-content">
    <!-- Close button -->
    <button
      onclick={closeFullscreen}
      class="absolute top-0 right-0 z-10 p-2 rounded bg-black/30 hover:bg-black/50 transition-colors cursor-pointer focus:outline-none"
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

    {#if controls}
      <div class="mb-4 flex-shrink-0 bg-black/90 rounded-lg px-4 py-3">
        {@render controls()}
      </div>
    {/if}
    <div class="flex-1 min-h-0 p-1 rounded-lg" style="background-color: var(--color-chart-frame)">
      <Chart {option} height="100%" />
    </div>
  </div>
</dialog>

<style>
  .fullscreen-dialog {
    /* Reset default dialog styles */
    border: none;
    padding: 0;
    background: transparent;
    max-width: none;
    max-height: none;
    width: 100vw;
    height: 100vh;
    /* Center the content */
    display: flex;
    align-items: center;
    justify-content: center;
    /* Remove focus outline - dialog doesn't need visual focus indication */
    outline: none;
  }

  .fullscreen-dialog::backdrop {
    background: rgba(0, 0, 0, 0.8);
  }

  .dialog-content {
    position: relative;
    width: 95vw;
    height: 90vh;
    max-width: 95vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    border: 2px solid var(--color-tan);
    border-radius: 0.5rem;
    padding: 1rem;
    background-color: #35302B;
  }
</style>
