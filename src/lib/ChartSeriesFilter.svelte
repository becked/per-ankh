<script lang="ts">
  /**
   * A reusable filter component for ECharts series.
   * Displays toggle buttons for each series that control visibility.
   * Works with ECharts' legend.selected option for filtering.
   */
  import { ToggleGroup } from "bits-ui";

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

  // Convert Record<string, boolean> to string[] for bits-ui
  const selectedNames = $derived(
    Object.entries(selected)
      .filter(([_, isSelected]) => isSelected)
      .map(([name]) => name)
  );

  // Convert string[] back to Record<string, boolean> when toggle changes
  function handleValueChange(newValue: string[]) {
    selected = Object.fromEntries(
      series.map((s) => [s.name, newValue.includes(s.name)])
    );
  }
</script>

<ToggleGroup.Root
  type="multiple"
  value={selectedNames}
  onValueChange={handleValueChange}
  class="flex flex-wrap items-center gap-2"
>
  {#each series as s}
    {@const isSelected = selected[s.name]}
    <ToggleGroup.Item
      value={s.name}
      class="px-3 py-1 text-xs rounded border-2 transition-all duration-200 cursor-pointer"
      style="background-color: {isSelected ? s.color : 'transparent'}; border-color: {s.color}; color: {isSelected ? getContrastColor(s.color) : s.color}; opacity: {isSelected ? 1 : 0.5};"
    >
      {s.name}
    </ToggleGroup.Item>
  {/each}
</ToggleGroup.Root>

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
