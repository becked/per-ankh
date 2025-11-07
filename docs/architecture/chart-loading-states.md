# Chart Loading States - Architecture Analysis

**Date**: January 7, 2025
**Status**: Parked for later implementation
**Related Review Item**: Issue #10 in code-review-2025-01-07.md

---

## Problem Statement

The Chart component (src/lib/Chart.svelte) currently has no loading state, which can cause:
- Flash of unstyled content (FOUC) during chart initialization
- Poor user experience when data loads slowly
- No feedback during async data fetching from Tauri commands

## Current Implementation

```typescript
// src/lib/Chart.svelte
let { option, height = "400px" }: { option: EChartsOption; height?: string } = $props();

onMount(() => {
  chart = echarts.init(chartContainer);
  chart.setOption(option as any);
  // ...
});
```

**Issues**:
- No visual feedback during ECharts initialization (~10-50ms)
- No loading state for data fetching (variable duration)
- Direct render can cause visual flash

---

## Architectural Options

### Option 1: Simple Internal State

Add a local loading state that tracks chart initialization within the Chart component.

**Implementation Sketch**:
```typescript
let isLoading = $state(true);

onMount(() => {
  chart = echarts.init(chartContainer);
  chart.setOption(option as any);
  isLoading = false;
  // ...
});

// Template
{#if isLoading}
  <LoadingSpinner />
{:else}
  <div bind:this={chartContainer} class="w-full h-full"></div>
{/if}
```

**Pros**:
- Simple to implement - self-contained within Chart component
- No API changes - parent components don't need updates
- Automatic - loading state managed internally
- Minimal code changes

**Cons**:
- Loading state only covers ECharts init, not data fetching
- Parent has no control over loading appearance
- Flash may still occur if data arrives after mount
- Less flexible for different loading scenarios

**Best For**: Quick fix if chart initialization is the main bottleneck

---

### Option 2: Parent-Controlled Loading State

Add an `isLoading` prop that parent components control.

**Implementation Sketch**:
```typescript
// Chart.svelte
let {
  option,
  height = "400px",
  isLoading = false
}: {
  option: EChartsOption;
  height?: string;
  isLoading?: boolean;
} = $props();

// Parent component
let isLoading = $state(true);
let chartData = $state<EChartsOption | null>(null);

onMount(async () => {
  isLoading = true;
  const data = await invoke<GameData>("get_game_data", { id });
  chartData = transformToChartOption(data);
  isLoading = false;
});

<Chart option={chartData} {isLoading} />
```

**Pros**:
- Parent controls when loading appears (before data fetch)
- More accurate loading state (covers full data lifecycle)
- Flexible - different parents can use different timing
- Simple Chart component - just shows/hides based on prop

**Cons**:
- Requires updating all parent components
- More boilerplate in parent components
- Parent must manually manage loading state
- Couples loading logic to parent implementation

**Best For**: Applications where data fetching is the primary delay

---

### Option 3: Data-Driven Loading (Automatic)

Automatically detect loading state by checking if option has data.

**Implementation Sketch**:
```typescript
// Chart.svelte
let isReady = $derived(
  option?.series?.length > 0 &&
  option.series.some(s => s.data && s.data.length > 0)
);

{#if !isReady}
  <LoadingSpinner />
{:else}
  <div bind:this={chartContainer} class="w-full h-full"></div>
{/if}
```

**Pros**:
- No manual state management needed
- Works automatically with any data source
- No prop changes needed
- Clean abstraction - loading tied to data presence

**Cons**:
- Assumes empty series = loading (may not always be true)
- Can't distinguish between "loading" and "no data"
- Less control over when loading appears
- Might not work for all chart types (some don't have series)
- Could incorrectly show loading for legitimate empty data

**Best For**: Uniform chart types where empty data always means loading

---

### Option 4: Dedicated ChartSkeleton Component

Create a reusable skeleton component that mimics chart appearance.

**Implementation Sketch**:
```typescript
// ChartSkeleton.svelte
<div class="w-full h-full bg-tan/10 rounded animate-pulse">
  <div class="h-4 bg-tan/20 w-1/3 mb-4"></div>
  <div class="flex items-end h-[calc(100%-2rem)] gap-2">
    {#each Array(8) as _, i}
      <div class="bg-tan/20 flex-1" style="height: {30 + Math.random() * 70}%"></div>
    {/each}
  </div>
</div>

// Parent component
{#if isLoading}
  <ChartSkeleton {height} />
{:else}
  <Chart {option} {height} />
{/if}
```

**Pros**:
- Separation of concerns - skeleton is separate component
- Reusable skeleton can be used elsewhere
- More sophisticated loading animation possible
- Can match chart shape/appearance closely
- Modern UX pattern (used by Facebook, LinkedIn, etc.)

**Cons**:
- More files/complexity
- Skeleton needs to stay in sync with chart appearance
- Parent still needs to manage loading state
- Overkill if loading is brief

**Best For**: Polished UX where loading times vary or are longer

---

### Option 5: Hybrid - Internal + Minimum Display Time

Internal state with guaranteed minimum loading time to prevent flashing.

**Implementation Sketch**:
```typescript
let isLoading = $state(true);
const MIN_LOADING_MS = 300;

onMount(async () => {
  const start = Date.now();
  chart = echarts.init(chartContainer);
  chart.setOption(option as any);

  const elapsed = Date.now() - start;
  if (elapsed < MIN_LOADING_MS) {
    await new Promise(r => setTimeout(r, MIN_LOADING_MS - elapsed));
  }

  isLoading = false;
});
```

**Pros**:
- Prevents jarring flash for quick loads
- Self-contained within Chart component
- No API changes needed
- Smooth user experience (no flash)
- Handles both fast and slow loads gracefully

**Cons**:
- Artificially delays chart appearance
- Adds complexity for edge case
- May feel slower than necessary
- Still doesn't cover data fetching time

**Best For**: Fast chart initialization where flash is the main problem

---

## Decision Criteria

### 1. Loading Duration Analysis

Measure typical loading times:
- **ECharts initialization**: ~10-50ms (fast)
- **Tauri command (local DuckDB)**: ~50-200ms (fast to medium)
- **Tauri command (complex query)**: ~200-1000ms (medium to slow)

**Question**: What are actual measured loading times for typical charts?

### 2. Loading Coverage Requirements

What should the loading state cover?
- [ ] Just ECharts initialization (10-50ms)
- [ ] Data fetching from Tauri commands (variable)
- [ ] Both initialization and data fetching

**Question**: Which parts of the lifecycle need loading feedback?

### 3. Visual Design Preferences

What should users see while loading?
- **Spinner**: Simple, clear, works everywhere
- **Skeleton**: Modern, mimics final layout, smoother transition
- **Empty state message**: Clear but less polished
- **Pulsing animation**: Subtle, less distracting

**Question**: What's the preferred loading visual style?

### 4. Consistency Requirements

- Should all loading states across the app look the same?
- Can charts have their own loading style?
- Are there existing loading patterns to follow?

**Question**: What loading patterns exist elsewhere in the app?

---

## Recommendation

**Recommended Approach**: Option 2 (Parent-Controlled Loading State)

**Rationale**:
1. Data comes from async Tauri commands, so parents already know when data is loading
2. Gives full control over the loading lifecycle
3. Can be enhanced later with a skeleton component (Option 4) if needed
4. Aligns with existing patterns where parents manage state
5. Covers the full data fetching → display lifecycle

**Implementation Priority**: Medium (not critical, enhances UX)

**Enhancement Path**:
1. Start with Option 2 (parent-controlled prop)
2. Add simple spinner/loading message
3. If loading times are longer or UX needs improvement, add Option 4 (skeleton)
4. If flash becomes an issue with fast loads, add minimum display time from Option 5

---

## Implementation Checklist (When Ready)

- [ ] Measure actual chart loading times
- [ ] Choose loading visual style (spinner vs skeleton)
- [ ] Update Chart.svelte to accept `isLoading` prop
- [ ] Create loading visual component
- [ ] Update parent components to manage loading state:
  - [ ] src/routes/game/[id]/+page.svelte (game detail page)
  - [ ] Any other components using Chart.svelte
- [ ] Test with slow network conditions (if remote data added)
- [ ] Add loading state to TypeScript types
- [ ] Update CLAUDE.md if new patterns are established

---

## Related Issues

- Code Review Issue #10: No Loading State for Charts
- Consider adding error states at the same time
- May want to standardize loading patterns across all async operations

---

**Next Steps**: Implement when prioritizing UX improvements or when chart loading becomes noticeable to users.
