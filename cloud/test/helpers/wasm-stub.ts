// Stand-in for a `.wasm` module import on Vitest's Node pool.
//
// `cloud/src/og-card/raster.ts` imports resvg's wasm as a module, which is how
// workerd compiles it at deploy time rather than at the first request. Node
// cannot resolve that import at all — wasm-bindgen's module declares an import
// of its own (`wbg`) that only a bundler supplies — so every unit test that
// reaches `src/index.ts`, which the four route-table audits do, failed to even
// load the suite.
//
// The unit project aliases the specifier here (cloud/vitest.config.mts). No
// unit test renders a card through `raster.ts`: og-card/card-svg.test.ts
// builds the SVG without it, and og-card/render.test.ts loads the real wasm
// off disk itself. A test that did reach the rasterizer would get this and
// fail loudly at `initWasm`, which is the right outcome — the Node pool has no
// way to serve that import.
export default null;
