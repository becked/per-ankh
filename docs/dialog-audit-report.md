# Dialog Usage Audit Report

**Date:** 2025-01-08
**Scope:** Frontend UI codebase (`src/` directory)
**Purpose:** Identify all dialogs not using Tauri's dialog plugin

---

## Executive Summary

**Total Non-Plugin Dialogs Found:** 3
**Files Affected:** 1
**Risk Level:** Medium (TypeScript cannot catch async/sync mismatch)

All dialog usage is currently using global `window.confirm()` and `alert()` functions instead of the Tauri dialog plugin (`@tauri-apps/plugin-dialog`). This creates a type safety issue where TypeScript cannot detect that these functions return Promises in Tauri.

---

## Findings

### File: `src/lib/Header.svelte`

**Function:** `handleResetDatabase()`
**Lines:** 51, 61, 65

#### Instance 1: Confirmation Dialog (Line 51)

```typescript
const confirmed = await window.confirm(
	"Are you sure you want to reset the database? This will delete all imported game data and cannot be undone.",
);
```

**Type:** Confirmation dialog
**Current Status:** ✅ Fixed with `await` (after bug discovery)
**Risk:** Medium - Worked correctly after adding `await`, but TypeScript doesn't enforce it
**Use Case:** Database reset confirmation

---

#### Instance 2: Success Alert (Line 61)

```typescript
alert("Database reset successfully.");
```

**Type:** Information alert
**Current Status:** ⚠️ Potentially problematic
**Risk:** Low - `alert()` doesn't return a value we check, but should still be awaited
**Use Case:** Success notification after database reset

---

#### Instance 3: Error Alert (Line 65)

```typescript
alert(`Failed to reset database: ${errorMsg}`);
```

**Type:** Error alert
**Current Status:** ⚠️ Potentially problematic
**Risk:** Low - Same as Instance 2
**Use Case:** Error notification if database reset fails

---

## Current State Analysis

### What We're Using

**File Dialogs (Backend - Rust):** ✅ Correctly using `tauri-plugin-dialog`

```rust
use tauri_plugin_dialog::DialogExt;

let dir_path = app
    .dialog()
    .file()
    .set_title("Select Directory with Save Files")
    .blocking_pick_folder();
```

**Simple Dialogs (Frontend - TypeScript):** ❌ Using `window.confirm()` and `alert()`

- No imports from `@tauri-apps/plugin-dialog` in frontend
- Relying on Tauri's runtime polyfill of global window functions

### Why This is Problematic

1. **Type Safety Issue:**
   - TypeScript thinks: `window.confirm(): boolean`
   - Tauri runtime actually: `window.confirm(): Promise<boolean>`
   - No compile-time errors, but runtime behavior differs from types

2. **Recent Bug:**
   - Line 51 originally didn't have `await`
   - Code proceeded immediately without waiting for user response
   - Only caught through console logging showing `Promise {status: "pending"}`

3. **Inconsistency:**
   - Backend uses Tauri plugin (type-safe)
   - Frontend uses global functions (not type-safe)

---

## Risk Assessment

| Instance          | Type         | Risk Level | Reason                                                    |
| ----------------- | ------------ | ---------- | --------------------------------------------------------- |
| Line 51 (confirm) | Confirmation | 🟡 Medium  | Fixed with `await`, but TypeScript won't catch if removed |
| Line 61 (alert)   | Information  | 🟡 Medium  | Should be awaited; execution continues without blocking   |
| Line 65 (alert)   | Error        | 🟡 Medium  | Same as line 61                                           |

**Overall Risk:** 🟡 Medium

While the current code works with `await` on `window.confirm()`, there's no type enforcement. Future developers might:

- Forget `await` on new dialog calls
- Remove `await` during refactoring
- Not realize `alert()` should also be awaited

---

## Recommendations

### Option 1: Migrate to Tauri Dialog Plugin (Recommended)

**Pros:**

- ✅ Full type safety
- ✅ Proper async/await enforcement by TypeScript
- ✅ More customization options (icons, titles, button labels)
- ✅ Consistent with backend usage
- ✅ Better error messages if used incorrectly

**Cons:**

- Requires imports and slightly more code
- Need to update existing code

**Implementation:**

```typescript
import { confirm, message } from "@tauri-apps/plugin-dialog";

async function handleResetDatabase() {
	isSettingsOpen = false;

	// Confirmation dialog with proper types
	const confirmed = await confirm(
		"Are you sure you want to reset the database? This will delete all imported game data and cannot be undone.",
		{ title: "Per Ankh", kind: "warning" },
	);

	if (!confirmed) {
		return;
	}

	try {
		await api.resetDatabase();
		// Success message
		await message("Database reset successfully.", {
			title: "Success",
			kind: "info",
		});
		refreshData.trigger();
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		// Error message
		await message(`Failed to reset database: ${errorMsg}`, {
			title: "Error",
			kind: "error",
		});
	}
}
```

---

### Option 2: Add Type Augmentation

Create `src/ambient.d.ts`:

```typescript
// Override browser types for Tauri environment
interface Window {
	confirm(message?: string): Promise<boolean>;
	alert(message?: string): Promise<void>;
	prompt(message?: string, defaultValue?: string): Promise<string | null>;
}
```

**Pros:**

- ✅ Makes existing code type-safe
- ✅ Minimal code changes

**Cons:**

- ❌ Maintenance burden
- ❌ May confuse developers familiar with browser APIs
- ❌ Doesn't prevent using wrong API in browser context
- ❌ Less customization than plugin

---

### Option 3: Keep Current Approach

Continue using `window.confirm()` and `alert()` with `await`.

**Pros:**

- ✅ No code changes needed
- ✅ Simple and familiar

**Cons:**

- ❌ No TypeScript enforcement
- ❌ Easy to forget `await`
- ❌ Inconsistent with backend
- ❌ Limited customization

---

## Migration Checklist

If migrating to Option 1 (Tauri Dialog Plugin):

- [ ] Import `confirm` and `message` from `@tauri-apps/plugin-dialog`
- [ ] Replace `window.confirm()` with `confirm()` (line 51)
- [ ] Replace `alert()` success message with `message()` (line 61)
- [ ] Replace `alert()` error message with `message()` (line 65)
- [ ] Add proper dialog configuration (title, kind/type)
- [ ] Test all dialog scenarios
- [ ] Update CLAUDE.md if needed with migration notes

---

## Additional Notes

### Plugin Already Installed

The project already has `@tauri-apps/plugin-dialog@2.4.2` installed and configured on the backend. The frontend can immediately start using it without any dependency changes.

### Type Definitions

The plugin provides proper TypeScript definitions:

```typescript
// From @tauri-apps/plugin-dialog
declare function confirm(
	message: string,
	options?: string | ConfirmDialogOptions,
): Promise<boolean>;

declare function message(
	message: string,
	options?: string | MessageDialogOptions,
): Promise<void>;
```

---

## Conclusion

While the current implementation works (with `await` added after the recent bug), it's recommended to migrate to the Tauri dialog plugin for:

1. Type safety
2. Consistency with backend
3. Better developer experience
4. Prevention of future bugs

The migration is straightforward and can be done incrementally or all at once.
