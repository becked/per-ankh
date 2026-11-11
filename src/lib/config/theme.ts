/**
 * The app's page background, as a hex literal.
 *
 * `--color-blue-gray` in src/app.css is the definition — `bg-blue-gray`
 * resolves it, and every surface in the ladder above it sits on it. This is
 * the same colour for the two consumers that have no stylesheet to resolve a
 * variable against: the `theme-color` meta tag, whose `content` attribute is
 * read before any CSS is (THEME_COLOR in $lib/page-meta), and the ECharts
 * canvas ground, which is painted from a config object (CHART_THEME in
 * ./charts). Both had their own copy; a chart whose ground is a shade off the
 * page it sits on is the drift this ends.
 *
 * Its own module, and not a constant in ./charts, so the meta tag can read it
 * without pulling the chart palettes and the baked yield-colour table into
 * every route's bundle.
 */
export const PAGE_BACKGROUND = "#211a12";
