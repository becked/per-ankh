# Benchmark Results: Save File Import Performance

**Date**: November 7, 2025
**Test Environment**: Release build, macOS
**Database**: DuckDB (temporary database in /tmp)

---

## Summary

Performance benchmarks reveal that current import speeds are **35x slower** than projected estimates from the hybrid parser architecture document.

**Key Finding**: Average import time of **7.4 seconds per save** instead of projected 213ms.

---

## Benchmark Results

### Single Save Import

**Save file**: `OW-Assyria-Year119-2025-11-02-10-50-56.zip` (742KB, Year 119)

```
Database setup:     69.5ms
Import time:        7,846ms (7.85 seconds)
Verification:       0.96ms

Entities imported:
  - 5 players
  - 449 characters
  - 43 cities
  - 5,476 tiles
  - Total: 5,973 entities

Throughput:         761 entities/second
```

### Multiple Save Imports (5 saves)

| Save               | File Size | Year | Import Time | Match ID |
| ------------------ | --------- | ---- | ----------- | -------- |
| OW-Assyria-Year119 | 742KB     | 119  | 8.02s       | 1        |
| OW-Rome-Year132    | 847KB     | 132  | 8.75s       | 2        |
| OW-Rome-Year97     | 222KB     | 97   | 2.52s       | 3        |
| OW-Assyria-Year134 | 806KB     | 134  | 8.36s       | 4        |
| OW-Aksum-Year142   | 919KB     | 142  | 9.40s       | 5        |

**Statistics:**

- **Total time**: 37.06 seconds
- **Average time**: 7.41 seconds per save
- **Min time**: 2.52 seconds (smaller/earlier game)
- **Max time**: 9.40 seconds (larger/later game)

---

## Performance Extrapolation

### Current Sequential Performance

| Batch Size | Projected Time   | User Experience  |
| ---------- | ---------------- | ---------------- |
| 1 save     | 7.4s             | Acceptable       |
| 10 saves   | 74s (~1.2 min)   | Frustrating      |
| 76 saves   | 563s (~9.4 min)  | **Unacceptable** |
| 266 saves  | 1,971s (~33 min) | **Catastrophic** |

### With Hybrid Parser + Parallel Batch (4 cores, 4.3x speedup)

Assuming we can achieve the projected 4.3x speedup from parallelization:

| Batch Size | Current Time | With Parallel    | Improvement  |
| ---------- | ------------ | ---------------- | ------------ |
| 1 save     | 7.4s         | 7.4s             | (no benefit) |
| 10 saves   | 74s          | ~17s             | 4.3x faster  |
| 76 saves   | 563s         | ~131s (~2.2 min) | 4.3x faster  |
| 266 saves  | 1,971s       | ~458s (~7.6 min) | 4.3x faster  |

Even with parallelization, **266 saves would take ~7.6 minutes** - still painful for onboarding.

---

## Performance Gap Analysis

### Expected vs. Actual

| Metric                 | Architecture Doc Estimate | Benchmark Actual | Ratio          |
| ---------------------- | ------------------------- | ---------------- | -------------- |
| Per-save time          | 213ms                     | 7,410ms          | **35x slower** |
| 76 saves (sequential)  | 16.2s                     | 563s             | **35x slower** |
| 266 saves (sequential) | 56.6s                     | 1,971s           | **35x slower** |

### What's Wrong?

The architecture document estimated:

- Parsing: ~106ms (sequential)
- Insertion: ~50ms
- **Total: ~156-213ms**

Actual performance shows **7,410ms** - something is dramatically slower than expected.

---

## Hypotheses for Performance Issues

### 1. **DuckDB Lock Contention (MOST LIKELY)**

The code review warned about this: "Very large transaction holds lock for entire import (potentially minutes)."

**Evidence:**

- Import times correlate with game size (Year 97 = 2.5s, Year 142 = 9.4s)
- All operations happen inside single transaction
- Lock held for entire import duration

**Potential causes:**

- IdMapper operations require locks for each entity
- DuckDB transaction overhead for large imports
- Appender flush operations blocking

**Fix priority**: HIGH - This is blocking progress

### 2. **XML Parsing Overhead**

**Observation**: 742KB compressed file → much larger uncompressed XML

**Potential issues:**

- ZIP extraction slower than expected
- XML DOM parsing (roxmltree) slower for large files
- Memory allocations during parsing

**To investigate:**

- Add timing breakdowns (ZIP extraction, XML parse, entity parse, insertion)
- Profile with `cargo flamegraph`

### 3. **Database Insertion Inefficiency**

**Potential issues:**

- Appender not being used optimally
- Foreign key constraint checking overhead
- Index updates during insertion
- Schema design inefficiencies

**To investigate:**

- Test with indices disabled
- Test with FK constraints disabled
- Measure Appender flush times

### 4. **IdMapper Overhead**

The IdMapper manages XML ID → DB ID mapping for all entities.

**Potential issues:**

- HashMap lookups for every entity
- Database queries during ID mapping
- Lock contention in IdMapper operations

**To investigate:**

- Profile IdMapper operations
- Count database queries during import

### 5. **Debug Logging Overhead**

Even in release mode, extensive `log::debug!` calls might slow things down.

**Unlikely** because:

- Release builds typically disable debug logging
- But worth checking log level settings

---

## Next Steps for Performance Investigation

### Immediate Actions

1. **Add timing breakdown** to see where time is spent:

   ```rust
   // Measure each stage
   let t1 = Instant::now();
   let xml = validate_and_extract_xml(path)?;
   println!("ZIP extraction: {:?}", t1.elapsed());

   let t2 = Instant::now();
   let doc = parse_xml(xml)?;
   println!("XML parsing: {:?}", t2.elapsed());

   let t3 = Instant::now();
   parse_players(&doc, &conn, &mut id_mapper)?;
   println!("Parse players: {:?}", t3.elapsed());
   // ... etc
   ```

2. **Profile with flamegraph**:

   ```bash
   cargo install flamegraph
   cargo flamegraph --test benchmark_import -- --nocapture benchmark_real_save_import
   ```

3. **Test without locks**:
   - Try removing the import lock temporarily
   - Test with multiple separate DB connections

4. **Test with FK constraints disabled**:
   ```sql
   PRAGMA foreign_keys = OFF;
   ```

### Secondary Investigations

5. **Measure XML size after extraction**:

   ```rust
   let xml_content = validate_and_extract_xml(path)?;
   println!("XML size: {} bytes ({:.1} MB)", xml_content.len(), xml_content.len() as f64 / 1_000_000.0);
   ```

6. **Count database operations**:
   - Wrap DuckDB connection with counter
   - Log every query/insert
   - Identify N+1 query problems

7. **Test hybrid parser speedup**:
   - Once hybrid parser is implemented
   - Re-run benchmarks
   - Measure actual parsing parallelization benefit

---

## Revised Performance Targets

Given the actual performance data, here are realistic targets:

### Short-term (Current Architecture)

| Target      | Time     | Achievable?                                |
| ----------- | -------- | ------------------------------------------ |
| Single save | < 5s     | ✅ (optimize current code)                 |
| 10 saves    | < 30s    | ✅ (6s avg, achievable with optimizations) |
| 76 saves    | < 5 min  | ⚠️ (requires significant optimization)     |
| 266 saves   | < 15 min | ❌ (likely impossible without parallel)    |

### Medium-term (With Hybrid Parser + Parallel)

| Target      | Time    | Achievable?         |
| ----------- | ------- | ------------------- |
| Single save | < 3s    | ✅ (faster parsing) |
| 10 saves    | < 10s   | ✅ (parallel batch) |
| 76 saves    | < 2 min | ✅ (parallel batch) |
| 266 saves   | < 7 min | ✅ (parallel batch) |

### Long-term (With Full Optimization)

| Target      | Time    | Achievable?                           |
| ----------- | ------- | ------------------------------------- |
| Single save | < 1s    | ⚠️ (requires aggressive optimization) |
| 10 saves    | < 5s    | ⚠️ (aggressive parallel + cache)      |
| 76 saves    | < 1 min | ✅ (parallel + optimizations)         |
| 266 saves   | < 3 min | ✅ (parallel + optimizations)         |

---

## Recommendations

### Priority 1: Diagnose Performance Bottleneck

**Do NOW:**

1. Add detailed timing instrumentation to import.rs
2. Run flamegraph profiler on single save import
3. Identify the slowest stage (ZIP? XML? Parsing? Insertion?)

**Expected outcome**: Identify specific bottleneck consuming 7+ seconds

### Priority 2: Optimize Current Architecture

**Do BEFORE hybrid parser migration:**

1. Fix identified bottleneck from Priority 1
2. Test with FK constraints disabled (measure impact)
3. Optimize IdMapper if it's the bottleneck
4. Consider smaller transaction scopes

**Goal**: Get single save to < 3 seconds

**Why before hybrid parser?** Hybrid parser won't help if insertion is the bottleneck!

### Priority 3: Implement Parallel Batch Import

**Do AFTER** current architecture is optimized:

1. Complete hybrid parser migration (Weeks 1-5)
2. Implement parallel batch import (Week 6)
3. Re-run benchmarks

**Expected outcome**: 4.3x speedup for batch imports

### Priority 4: Advanced Optimizations

**Consider if still not fast enough:**

1. Caching: Serialize GameData to disk, skip re-parsing
2. Incremental imports: Only import changed data
3. Database tuning: Adjust DuckDB settings
4. Schema optimization: Remove unnecessary indices during import

---

## Conclusion

**Current state**: Import performance is **35x slower** than estimated, making onboarding with 266 saves take **33 minutes** (unacceptable).

**Root cause**: Unknown - requires profiling. Likely DuckDB lock contention or XML parsing overhead.

**Path forward**:

1. **Diagnose** the bottleneck (Priority 1) ← DO THIS FIRST
2. **Optimize** current code to < 3s per save (Priority 2)
3. **Parallelize** with hybrid parser for 4.3x speedup (Priority 3)
4. **Target**: Get 266 saves from 33 minutes → 7 minutes → 3 minutes

**Realistic timeline**:

- Week 1: Diagnose + optimize current architecture (< 3s per save)
- Weeks 2-6: Hybrid parser migration
- Week 7: Parallel batch import
- Week 8: Final optimizations
- **Final result**: 266 saves in ~3-5 minutes ✅

---

## Appendix: Test Output

### Single Save Benchmark

```
=== Per-Ankh Save File Import Benchmark ===

Database setup: 69.514833ms
Save file: ../test-data/saves/OW-Assyria-Year119-2025-11-02-10-50-56.zip
File size: 742KB

Starting import...

=== Results ===

Total import time: 7.846274s
Success: true
Match ID: Some(1)
Game ID: d0b5a744-9368-4f3f-ab27-4ed7f803a01c

Imported entities:
  - 5 players
  - 449 characters
  - 43 cities
  - 5476 tiles

Verification queries: 956.75µs

=== Performance Analysis ===

Import time: 7846ms
Throughput: 761 entities/second
```

### Multiple Saves Benchmark

```
=== Multiple Import Benchmark ===

Import 1/5...
  OW-Assyria-Year119-2025-11-02-10-50-56.zip - 8.022387458s (match_id: Some(1))
Import 2/5...
  OW-Rome-Year132-2025-11-01-16-13-00.zip - 8.750520292s (match_id: Some(2))
Import 3/5...
  OW-Rome-Year97-2025-10-09-00-13-02.zip - 2.521197333s (match_id: Some(3))
Import 4/5...
  OW-Assyria-Year134-2025-10-25-21-55-54.zip - 8.360923167s (match_id: Some(4))
Import 5/5...
  OW-Aksum-Year142-2025-08-03-21-01-35.zip - 9.404914s (match_id: Some(5))

=== Statistics ===

Total time: 37.05994225s
Average time: 7.41198845s
Min time: 2.521197333s
Max time: 9.404914s

Extrapolation:
  10 saves: ~74110ms (~74.1s)
  76 saves: ~563236ms (~563.2s)
  266 saves: ~1971326ms (~1971.3s)
```

---

**Generated**: November 7, 2025
**Benchmark code**: `src-tauri/tests/benchmark_import.rs`
**Test command**: `cargo test --test benchmark_import --release -- --nocapture`
