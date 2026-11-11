// Ambient declaration for a `.wasm` import, which workerd compiles at deploy
// time and hands over as an already-instantiated `WebAssembly.Module` (the
// built-in CompiledWasm module rule). Only the resvg rasterizer uses one —
// cloud/src/og-card/raster.ts.
//
// Kept in its own file so the `declare module` is an ambient declaration
// rather than an augmentation, the same reason node-async-hooks.d.ts is
// separate.

declare module "*.wasm" {
	const wasmModule: WebAssembly.Module;
	export default wasmModule;
}
