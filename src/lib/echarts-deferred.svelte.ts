// The ECharts chunk, fetched when a chart is about to render.
//
// `$lib/echarts` is the one module that imports ECharts for its runtime, and
// the chunk it lands in is 203.8 KB gzip. Imported statically it was part of
// the static-import closure of all nine routes that can render a chart — bytes
// SvelteKit modulepreloads before the route renders, the landing page's
// included, where it was 54% of the page's JS (#298). The `import()` below is
// what puts it in a chunk of its own.
//
// `Chart.svelte` is the only module that reads this slot, and it is the one
// component every chart in the app renders through, so the twenty-two modules
// that draw a chart reach the library through here unchanged.
import { deferred } from "$lib/deferred.svelte";

export const ECHARTS = deferred(() => import("$lib/echarts"));
