# Auto-Generated TypeScript Types

⚠️ **DO NOT EDIT FILES IN THIS DIRECTORY** ⚠️

These TypeScript type definitions are automatically generated from Rust structs using [ts-rs](https://github.com/Aleph-Alpha/ts-rs).

## How It Works

1. Rust structs in `src-tauri/src/` are annotated with `#[derive(TS)]` and `#[ts(export)]`
2. When you run tests, ts-rs generates corresponding TypeScript types
3. These types are exported through `src/lib/types.ts`

## Regenerating Types

Types are automatically regenerated:
- **Before running dev server**: `npm run tauri:dev`
- **Before building**: `npm run tauri:build`
- **On git commit**: When you commit changes to `.rs` files (via pre-commit hook)

To manually regenerate:
```bash
npm run types:generate
```

## Adding New Types

In your Rust code:
```rust
use ts_rs::TS;

#[derive(Serialize, TS)]
#[ts(export, export_to = "../../src/lib/types/")]
pub struct MyNewType {
    pub field: String,
}
```

Then run `cargo test --lib export_bindings` to generate the TypeScript type.

## Why Auto-Generate?

This approach ensures:
- ✅ Type safety between Rust backend and TypeScript frontend
- ✅ No manual synchronization needed
- ✅ Types always match the Rust structs
- ✅ Reduces maintenance burden
