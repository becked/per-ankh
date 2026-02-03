# Chart Sizing Issue - Troubleshooting Log

## Problem Description

Charts sometimes render with incorrect dimensions when navigating between different games. The chart appears compressed/small and doesn't fill the available container space properly. However, clicking the same game in the sidebar again causes the chart to render correctly at full size.

### Symptoms

- Chart renders small/compressed on initial load of some games
- Same chart renders correctly when clicking the same game again
- Suggests a timing/initialization issue rather than a data problem
- Issue is inconsistent - some games load fine, others don't

## Root Cause Analysis

The key observation: **clicking the same game twice makes it work** suggests that:

1. The component is being fully remounted on the second click
2. The container has proper dimensions on remount
3. The initial render happens before the container has been sized properly

## Attempted Solutions

### 1. ~~Chart Border Color Change~~ ✅ (Not related to sizing)

**What we tried:** Changed chart container border from white (`#FFFFFF`) to light gray (`#EEEEEE`)

- Updated `bg-white` to `bg-gray-200` in all chart containers
- **Result:** Successfully changed the color, but didn't affect sizing issue

### 2. ~~`requestAnimationFrame()` Resize~~ ❌

**Hypothesis:** Chart needs to resize after the DOM has finished painting
**What we tried:**

```typescript
chart.setOption(option as any, true);
requestAnimationFrame(() => {
	chart?.resize();
});
```

**Result:** No change - charts still render incorrectly

### 3. ~~`setTimeout()` with Explicit Dimensions~~ ❌

**Hypothesis:** Need to wait for container to have dimensions, then force resize with explicit width/height
**What we tried:**

```typescript
chart.setOption(option as any, true);
setTimeout(() => {
	if (chart && chartContainer) {
		chart.resize({
			width: chartContainer.clientWidth,
			height: chartContainer.clientHeight,
		});
	}
}, 0);
```

**Result:** No change - charts still render incorrectly

### 4. ~~Dispose and Reinitialize on Option Change~~ ❌

**Hypothesis:** Chart instance gets corrupted when data changes, need fresh initialization
**What we tried:** Modified `$effect` in Chart.svelte to completely dispose and reinitialize:

```typescript
$effect(() => {
	if (chart) {
		chart.dispose();
		chart = null;
	}

	if (
		chartContainer &&
		chartContainer.clientWidth > 0 &&
		chartContainer.clientHeight > 0
	) {
		chart = echarts.init(chartContainer);
		chart.setOption(option as any);
	} else {
		setTimeout(() => {
			if (
				chartContainer &&
				chartContainer.clientWidth > 0 &&
				chartContainer.clientHeight > 0
			) {
				chart = echarts.init(chartContainer);
				chart.setOption(option as any);
			}
		}, 50);
	}
});
```

**Result:** No change - charts still render incorrectly

### 5. ~~`{#key}` Block Around Tab Content~~ ❌

**Hypothesis:** Force Svelte to remount entire tab content when game changes
**What we tried:** Wrapped tab content in `{#key gameDetails?.match_id}` block

```svelte
{#key gameDetails?.match_id}
	<h2>Game History</h2>
	{#if pointsChartOption}
		<Chart option={pointsChartOption} />
	{/if}
{/key}
```

**Result:** No change - charts still render incorrectly

### 6. ~~Individual `{#key}` Blocks Per Chart~~ ❌ (Current attempt)

**Hypothesis:** Each chart needs its own unique key for complete remounting
**What we tried:** Wrapped each chart in its own key block:

```svelte
{#key `${gameDetails?.match_id}-points`}
	<div class="mb-6 rounded-lg border-2 border-tan bg-gray-200 p-4">
		<Chart option={pointsChartOption} height="400px" />
	</div>
{/key}
```

Plus simplified the `$effect` since keys handle remounting:

```typescript
$effect(() => {
	if (chart) {
		chart.setOption(option as any, true);
	}
});
```

**Result:** No change - charts still render incorrectly

## Next Steps to Try

### 7. Add Visibility Check

ECharts may not initialize properly if the container is hidden (e.g., in a non-active tab). Could add:

- Check if tab is active before initializing
- Use IntersectionObserver to detect when chart becomes visible
- Defer chart initialization until tab is switched to

### 8. Hard-coded Dimensions

As a test, try initializing charts with hard-coded dimensions to see if the issue is truly about container sizing:

```typescript
chart = echarts.init(chartContainer, null, {
	width: 1000,
	height: 400,
});
```

### 9. Debug Logging

Add extensive logging to understand what's happening:

```typescript
console.log("Chart init:", {
	containerWidth: chartContainer.clientWidth,
	containerHeight: chartContainer.clientHeight,
	matchId: gameDetails?.match_id,
	timestamp: Date.now(),
});
```

### 10. React to Page Params Directly

Instead of relying on derived state, watch `$page.params.id` directly in Chart component or use it as part of the key.

### 11. Force Container Reflow

Try forcing a reflow before chart initialization:

```typescript
void chartContainer.offsetHeight; // Force reflow
chart = echarts.init(chartContainer);
```

## Questions to Answer

1. What are the actual dimensions of `chartContainer` when the chart initializes incorrectly?
2. Is the parent container sized properly when the chart tries to initialize?
3. Does the issue occur only for the first chart or all charts on the page?
4. Is there a difference in timing between "works" and "doesn't work" scenarios?
5. Are the chart options being computed correctly in both cases?

## Related Files

- `/src/lib/Chart.svelte` - Chart component with ECharts initialization
- `/src/routes/game/[id]/+page.svelte` - Game detail page with chart rendering
- Issue first observed: 2025-11-10
