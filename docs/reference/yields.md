# Why Old World Uses Fixed-Point Arithmetic for Yields

## Technical Background

Old World's decision to store yields in units of 0.1 (requiring ÷10 for display) is an implementation of **fixed-point arithmetic** - a well-established game development pattern.

## The Problem with Floating Point

### 1. **Precision Errors**
```csharp
// C# floating point example
float science = 0.1f;
for (int i = 0; i < 10; i++) {
    science += 0.1f;
}
// Expected: 1.0
// Actual: 1.0000001 or 0.9999999
```

**Why this matters for Old World:**
- 100+ turns of calculations
- Thousands of tiles, units, buildings generating yields
- Compounding rounding errors could cause:
  - Tech costs to never exactly match accumulated science
  - Desync issues in multiplayer
  - Non-deterministic replays

### 2. **Multiplayer Determinism**

Old World is a **turn-based multiplayer game** that needs perfect synchronization:

```csharp
// Player 1 (Windows x64, Intel CPU)
float yield = CalculateYield(); // 21.500001

// Player 2 (Mac ARM, M1 chip)
float yield = CalculateYield(); // 21.499999

// After 50 turns of compound calculations: DESYNC!
```

**Fixed-point solution:**
```csharp
// Both platforms, guaranteed identical
int yield = 215; // Stored as integer
// Display: yield / 10 = 21.5
```

### 3. **Performance**

Strategy games run many calculations per turn:

**Per-turn yield calculation:**
- ~50-100 tiles per player
- Each tile: base yield + improvements + bonuses + adjacency
- 2 players × 100 turns × 100 tiles × 5 yields = **100,000 calculations**

**Integer vs Float performance:**
```csharp
// Integer arithmetic (what Old World uses)
int result = (base * modifier) / 100;  // Fast, exact

// Float arithmetic (slower, imprecise)
float result = base * (modifier / 100f);  // Slower, rounding errors
```

Modern CPUs are faster at integer operations, especially for exact division by powers of 10.

## Why "Divide by 10" Specifically?

### Choice of Scale Factor

Games typically choose scale factors based on precision needs:

| Game Type | Scale Factor | Precision | Example |
|-----------|-------------|-----------|---------|
| Old World yields | 10 | 0.1 | 21.5 science/turn |
| Economic sims | 100 | 0.01 | $99.99 |
| Physics engines | 1000+ | 0.001+ | Position coordinates |

**Old World's choice of 10:**
- ✅ Allows decimal precision (21.5, not just 21 or 22)
- ✅ Simple mental math for developers (215 → 21.5)
- ✅ Small storage size (no need for 1000x or higher)
- ✅ Covers typical yield ranges (0.1 to 999.9)

### Alternative: Floating Point

```csharp
// Option 1: Store as float
public float Science { get; set; }

// Problems:
// - 4 bytes per value (same as int32)
// - Non-deterministic across platforms
// - Precision errors compound over time
// - Serialization complexity (XML, JSON, binary)
```

```csharp
// Option 2: Store as integer with scale (Old World's approach)
private int _science; // 215 = 21.5
public float ScienceDisplay => _science / 10f;

// Benefits:
// - 4 bytes per value
// - Deterministic everywhere
// - Exact arithmetic
// - Simple XML: <YIELD_SCIENCE>215</YIELD_SCIENCE>
```

## C# and .NET Specifics

### Why Integers Work Better in C#

```csharp
// 1. Decimal type exists but has overhead
public decimal Science { get; set; }  // 16 bytes! (vs 4 for int)

// 2. Float/double have platform differences
public float Science { get; set; }    // 4 bytes, but imprecise

// 3. Integer is best compromise
private int _scienceTenths;           // 4 bytes, exact
public float Display => _scienceTenths / 10f;  // Only for UI
```

### .NET Serialization Benefits

**XML Serialization (what Old World uses):**
```xml
<!-- Integer: Simple, exact -->
<YIELD_SCIENCE>215</YIELD_SCIENCE>

<!-- Float: Platform-dependent representation -->
<YIELD_SCIENCE>21.5</YIELD_SCIENCE>
<!-- Might serialize as 21.500000 or use scientific notation -->

<!-- Decimal: Verbose -->
<YIELD_SCIENCE>21.5</YIELD_SCIENCE>
<!-- But serializes with type metadata -->
```

### Cross-Platform Consistency

Old World runs on:
- Windows (x64, x86)
- macOS (Intel, Apple Silicon)
- Linux (various architectures)

**Float representation varies:**
- IEEE 754 standard has implementation differences
- JIT compilation affects precision
- CPU FPU units differ (x86 vs ARM)

**Integer representation is identical:**
```csharp
int yield = 215;  // Exactly 215 on ALL platforms
```

## Real-World Examples

### Similar Games Using Fixed-Point

**Civilization series:**
- Uses integer percentages for many values
- Food, production often scaled by 100

**Crusader Kings / Europa Universalis (Paradox):**
- Fixed-point for monthly income/expenses
- Integer math for deterministic multiplayer

**StarCraft II:**
- All unit stats are integers
- Damage, health, shields use fixed-point
- Attack speed stored as "cooldown frames"

### Industry Standard Pattern

This pattern appears in:
- Financial software (cents, not dollars)
- Physics engines (units of 0.001m)
- Network games (tick-based state sync)
- Database systems (DECIMAL for money)

## Why Not Use .NET Decimal?

```csharp
public decimal Science { get; set; }
```

**Drawbacks:**
1. **Size:** 16 bytes vs 4 bytes for int
   - 4x memory per value
   - Slower cache performance
   - Larger save files

2. **Performance:** Slower arithmetic
   - No CPU hardware support
   - Software emulation required
   - 10-100x slower than integer ops

3. **Overkill:** Decimal has 28-29 digit precision
   - Old World only needs 1 decimal place
   - Wasting precision and performance

## The Display Layer Separation

### Clean Architecture Pattern

```csharp
// Domain/Game Logic Layer (integers)
class Player {
    private int _scienceTenths = 215;

    public void AddScience(int tenths) {
        _scienceTenths += tenths;  // Fast, exact
    }
}

// Presentation/UI Layer (floats for display)
class PlayerStatsUI {
    public void ShowScience(Player player) {
        float display = player.ScienceTenths / 10f;
        Console.WriteLine($"Science: {display:F1}");  // "Science: 21.5"
    }
}
```

**Benefits:**
- Game logic never touches floats
- Display code handles conversion
- Clean separation of concerns

## Conclusion

Old World uses fixed-point arithmetic (÷10) because:

1. **Determinism:** Multiplayer requires identical calculations across platforms
2. **Precision:** Avoids floating-point rounding errors over hundreds of turns
3. **Performance:** Integer arithmetic is faster than float operations
4. **Simplicity:** XML serialization is cleaner with integers
5. **Platform Independence:** Integers behave identically everywhere

This is **not about XML or C# convenience** - it's about **game simulation correctness**.

The ÷10 rule exists at the **boundary between game logic and display** - the game thinks in integers (exact), humans think in decimals (readable).

## Our Implementation

We mirror the game's architecture:

```
XML (raw)  →  Parser  →  Database (raw)  →  View (display)  →  Frontend
   215          ↓           215              ÷10 → 21.5          charts
             no-op
```

```rust
// Parser: Store raw integers from XML (no conversion)
let amount: i32 = xml_value.parse()?;  // 215

// Database: Store raw integers in base tables
INSERT INTO yield_history (amount) VALUES (?);  // 215

// View: Convert to display values (single source of truth)
CREATE VIEW yield_history_display AS
SELECT amount / 10.0 AS amount FROM yield_history;  // 21.5

// Queries: Use the view for display
SELECT amount FROM yield_history_display;  // 21.5
```

**Benefits:**
- Raw integers preserved for potential future calculations
- Conversion happens in exactly one place (the view)
- Queries don't repeat `/10.0` everywhere (DRY)

---

**References:**
- Fixed-Point Arithmetic: https://en.wikipedia.org/wiki/Fixed-point_arithmetic
- IEEE 754 Floating Point: https://en.wikipedia.org/wiki/IEEE_754
- Game Programming Patterns: https://gameprogrammingpatterns.com/
- C# Decimal Type: https://learn.microsoft.com/en-us/dotnet/api/system.decimal
