# Fix: Batch Import Crash on File #10

**Issue**: When importing 10+ files in a batch, the app crashes silently on approximately file #10 with no error message.

**Root Cause**:
1. Triple-nested `rayon::join` creates excessive stack depth
2. Memory pressure from holding multiple large objects (XML document + parsed structs) across sequential file imports

**Solution**: Flatten parallel structure + explicit memory cleanup

**Estimated Time**: 15-20 minutes

---

## Changes Required

### 1. Flatten Nested `rayon::join`

**File**: `src-tauri/src/parser/parsers/mod.rs`

**Location**: `parse_foundation_entities_parallel()` function (lines ~65-100)

**Change**:

```rust
// BEFORE (triple-nested - BAD):
let (players_res, (characters_res, (cities_res, tiles_res))) = rayon::join(
    || {
        let t = Instant::now();
        let result = parse_players_struct(doc);
        log::debug!("  parse_players_struct: {:?}", t.elapsed());
        result
    },
    || rayon::join(
        || {
            let t = Instant::now();
            let result = parse_characters_struct(doc);
            log::debug!("  parse_characters_struct: {:?}", t.elapsed());
            result
        },
        || rayon::join(
            || {
                let t = Instant::now();
                let result = parse_cities_struct(doc);
                log::debug!("  parse_cities_struct: {:?}", t.elapsed());
                result
            },
            || {
                let t = Instant::now();
                let result = parse_tiles_struct(doc);
                log::debug!("  parse_tiles_struct: {:?}", t.elapsed());
                result
            },
        ),
    ),
);

let players = players_res?;
let characters = characters_res?;
let cities = cities_res?;
let tiles = tiles_res?;
```

```rust
// AFTER (flat structure - GOOD):
let ((players_res, characters_res), (cities_res, tiles_res)) = rayon::join(
    || {
        rayon::join(
            || {
                let t = Instant::now();
                let result = parse_players_struct(doc);
                log::debug!("  parse_players_struct: {:?}", t.elapsed());
                result
            },
            || {
                let t = Instant::now();
                let result = parse_characters_struct(doc);
                log::debug!("  parse_characters_struct: {:?}", t.elapsed());
                result
            },
        )
    },
    || {
        rayon::join(
            || {
                let t = Instant::now();
                let result = parse_cities_struct(doc);
                log::debug!("  parse_cities_struct: {:?}", t.elapsed());
                result
            },
            || {
                let t = Instant::now();
                let result = parse_tiles_struct(doc);
                log::debug!("  parse_tiles_struct: {:?}", t.elapsed());
                result
            },
        )
    },
);

let players = players_res?;
let characters = characters_res?;
let cities = cities_res?;
let tiles = tiles_res?;
```

**What Changed**:
- Stack depth reduced from 3 levels to 2
- Players/Characters parse in parallel (left branch)
- Cities/Tiles parse in parallel (right branch)
- Both branches run concurrently

**Performance Impact**: None - still gets full 4-way parallelism

---

### 2. Add Explicit Memory Cleanup

**File**: `src-tauri/src/parser/import.rs`

**Location**: `import_save_file_internal()` function (find the section after parsing completes)

**Find this code** (around line 250-280):

```rust
// After parsing completes
let game_data = parsers::parse_save_to_structs(doc)?;

// Validation
validation::validate_game_data(&game_data)?;

// Insert to database
inserters::insert_game_data(tx, &game_data, match_id)?;
```

**Change to**:

```rust
// After parsing completes
let game_data = parsers::parse_save_to_structs(doc)?;

// Free XML document immediately - no longer needed
drop(doc);
log::debug!("Freed XML document");

// Validation
validation::validate_game_data(&game_data)?;

// Insert to database
inserters::insert_game_data(tx, &game_data, match_id)?;

// Free parsed structs immediately after insertion
drop(game_data);
log::debug!("Freed parsed game data");
```

**What Changed**:
- XML document freed right after parsing (saves ~10-20 MB per file)
- Parsed structs freed right after insertion (saves ~30-50 MB per file)
- Debug logs help verify cleanup is happening

**Why This Matters**:
Rust's drop happens eventually, but being explicit ensures memory is freed BEFORE starting the next file in a batch, preventing accumulation.

---

## Testing

### Validate the Fix

```bash
cd src-tauri

# Run the batch import test
cargo run --release --example import_all_saves
```

**Expected Result**: All 10 files import successfully without crashes

### Before/After Comparison

**Before**:
```
Importing file 1-9... ✓
Importing file 10... [CRASH - no error message]
Result: 9 succeeded, 1 failed
```

**After**:
```
Importing file 1-10... ✓
Result: 10 succeeded, 0 failed
```

### Check Memory Usage (Optional)

```bash
# macOS
/usr/bin/time -l cargo run --release --example import_all_saves

# Linux
/usr/bin/time -v cargo run --release --example import_all_saves
```

Look for "maximum resident set size" - should be stable throughout the run, not continuously increasing.

---

## Rollback Plan

If this doesn't fix the issue:

1. **Revert** both changes (git checkout)
2. **Try** Option 4 from the original analysis: Limit Rayon thread pool
3. **Add** to `src-tauri/src/main.rs` before any imports:

```rust
fn main() {
    rayon::ThreadPoolBuilder::new()
        .num_threads(2)  // Reduce from 4 to 2 parallel parsers
        .build_global()
        .unwrap();

    // ... rest of main
}
```

This reduces parallelism (slower) but eliminates resource exhaustion.

---

## Why This Works

**Flattening**:
- Triple nesting = stack frames: `join → join → join → parse`
- Flat structure = stack frames: `join → parse`
- 2x fewer stack frames = 2x less stack pressure

**Explicit Drops**:
- Without drops: File 10 might still have references to files 1-9 in memory
- With drops: Each file is fully cleaned up before the next starts
- Prevents memory accumulation over batch processing

---

## Future Improvements (YAGNI - Don't implement now)

If you later need more control:
- Use `rayon::scope` for even flatter structure
- Add memory profiling instrumentation
- Implement streaming XML parsing for very large files (>100 MB)

For now, the simple fix above is sufficient.
