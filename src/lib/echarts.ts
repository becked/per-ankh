/**
 * The ECharts build we ship.
 *
 * `import * as echarts from "echarts"` pulls every series type and both
 * renderers — ~1.1 MB raw, evaluated during hydration wherever a chart lives,
 * including the landing page. This module registers only the pieces we use and
 * is the one place that imports ECharts for its runtime.
 *
 * `ChartOption` is composed from exactly the registered set. Build options
 * against it, never `EChartsOption` from the `echarts` barrel: the barrel type
 * describes every series ECharts ships, so it accepts what this build can't
 * draw — and an unregistered feature renders a blank chart rather than throwing.
 *
 * The guard is partial. An unregistered `series.type` is a type error, but an
 * unregistered *component* key (`dataZoom`, `visualMap`, `toolbox`, …) still
 * type-checks: ComposeOption's base carries an index signature, so excess
 * property checking never fires on it. Reaching for a component means checking
 * it is registered below.
 *
 * Adding a chart type means adding it in both lists below, together.
 */
import { use } from "echarts/core";
import { BarChart, CustomChart, LineChart, PieChart } from "echarts/charts";
import {
	AxisPointerComponent,
	CalendarComponent,
	GridComponent,
	LegendComponent,
	MarkLineComponent,
	TitleComponent,
	TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

import type { ComposeOption } from "echarts/core";
import type {
	BarSeriesOption,
	CustomSeriesOption,
	LineSeriesOption,
	PieSeriesOption,
} from "echarts/charts";
import type {
	AxisPointerComponentOption,
	CalendarComponentOption,
	GridComponentOption,
	LegendComponentOption,
	MarkLineComponentOption,
	TitleComponentOption,
	TooltipComponentOption,
} from "echarts/components";

// AxisPointerComponent is auto-installed by both the tooltip and grid installs,
// but `tooltip.axisPointer` is configured directly at ~13 sites — registered
// explicitly so it doesn't silently depend on another component staying.
use([
	BarChart,
	CustomChart,
	LineChart,
	PieChart,
	AxisPointerComponent,
	CalendarComponent,
	GridComponent,
	LegendComponent,
	MarkLineComponent,
	TitleComponent,
	TooltipComponent,
	// Canvas only — nothing requests the SVG renderer.
	CanvasRenderer,
]);

export { init, registerTheme } from "echarts/core";
export type { ECharts, ECElementEvent } from "echarts/core";
export type { LineSeriesOption } from "echarts/charts";

export type ChartOption = ComposeOption<
	| BarSeriesOption
	| CustomSeriesOption
	| LineSeriesOption
	| PieSeriesOption
	| AxisPointerComponentOption
	| CalendarComponentOption
	| GridComponentOption
	| LegendComponentOption
	| MarkLineComponentOption
	| TitleComponentOption
	| TooltipComponentOption
>;
