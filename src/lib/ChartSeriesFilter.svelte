<script lang="ts">
  /**
   * A reusable filter component for ECharts series.
   * Displays clickable buttons for each series that toggle visibility.
   * Works with ECharts' legend.selected option for filtering.
   */

  export type SeriesInfo = {
    name: string;
    color: string;
  };

  let {
    series,
    selected = $bindable<Record<string, boolean>>({}),
  }: {
    series: SeriesInfo[];
    selected?: Record<string, boolean>;
  } = $props();

  function toggleSeries(name: string) {
    selected = {
      ...selected,
      [name]: !selected[name],
    };
  }

  function selectAll() {
    selected = Object.fromEntries(series.map((s) => [s.name, true]));
  }

  function selectNone() {
    selected = Object.fromEntries(series.map((s) => [s.name, false]));
  }

  // Count how many are selected
  const selectedCount = $derived(
    Object.values(selected).filter(Boolean).length
  );
  const allSelected = $derived(selectedCount === series.length);
  const noneSelected = $derived(selectedCount === 0);
</script>

<div class="flex flex-wrap items-center gap-2">
  <!-- Select All / None buttons -->
  <div class="flex gap-1 mr-2">
    <button
      onclick={selectAll}
      disabled={allSelected}
      class="px-2 py-1 text-xs rounded border border-black transition-colors
             {allSelected ? 'bg-gray-400 text-gray-600 cursor-not-allowed' : 'bg-tan text-black hover:bg-tan-hover'}"
    >
      All
    </button>
    <button
      onclick={selectNone}
      disabled={noneSelected}
      class="px-2 py-1 text-xs rounded border border-black transition-colors
             {noneSelected ? 'bg-gray-400 text-gray-600 cursor-not-allowed' : 'bg-tan text-black hover:bg-tan-hover'}"
    >
      None
    </button>
  </div>

  <!-- Series toggle buttons -->
  {#each series as s}
    <button
      onclick={() => toggleSeries(s.name)}
      class="px-3 py-1 text-sm rounded border-2 transition-all duration-200"
      style:background-color={selected[s.name] ? s.color : 'transparent'}
      style:border-color={s.color}
      style:color={selected[s.name] ? getContrastColor(s.color) : s.color}
      style:opacity={selected[s.name] ? 1 : 0.5}
    >
      {s.name}
    </button>
  {/each}
</div>

<script lang="ts" module>
  /**
   * Returns black or white depending on which has better contrast with the given color.
   */
  function getContrastColor(hexColor: string): string {
    // Remove # if present
    const hex = hexColor.replace('#', '');

    // Parse RGB
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Calculate relative luminance (simplified)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    return luminance > 0.5 ? '#000000' : '#FFFFFF';
  }
</script>
