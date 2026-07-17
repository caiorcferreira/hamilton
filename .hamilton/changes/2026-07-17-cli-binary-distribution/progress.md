# Progress: CLI Binary Distribution

## Task 1: Add `resolveBundleRoot()` with injectable inputs and full branch coverage

**Status**: ✅ Complete

**Files created**:
- `src/cli/bundle-root.ts` - exports `resolveBundleRoot()`, `ResolveBundleRootOptions`, and `BundleRootNotFoundError`
- `tests/cli/bundle-root.test.ts` - 8 test cases covering all 5 acceptance requirements

**Verification**:
- ✅ `bun --bun vitest run tests/cli/bundle-root.test.ts` → 8/8 tests pass
- ✅ `bun run build` → no type errors (clean build with existing warnings only)
- ✅ All acceptance criteria covered by tests:
  - ✅ Source checkout resolution when no env override
  - ✅ Binary-sibling path resolution
  - ✅ BundleRootNotFoundError thrown with all checked paths when neither exists
  - ✅ HAMILTON_BUNDLE_DIR env var takes precedence
  - ✅ HAMILTON_BUNDLE_DIR falls through when non-existent

**Notes**:
- Implementation exactly matches plan specification
- Exported signature: `resolveBundleRoot(options?: ResolveBundleRootOptions): string`
- ResolveBundleRootOptions interface provides injectable dependencies for testability
- Binary-sibling calculation uses realpath to handle symlinks correctly
- Source checkout calculation resolves 2 levels up from `src/cli/` to repo root

---

## Task 2: Wire `setup.ts` to `resolveBundleRoot()`

**Status**: ✅ Complete

**Files modified**:
- `src/cli/commands/setup.ts` - removed PROJECT_ROOT constant, imported resolveBundleRoot, modified all copy functions to accept bundleRoot parameter, updated setupHamilton to resolve bundle root once
- `tests/cli/setup.test.ts` - added new describe block "bundle root resolution" with test for HAMILTON_BUNDLE_DIR env var override

**Changes made**:
1. Removed module-level `PROJECT_ROOT` constant
2. Imported `resolveBundleRoot` from `../bundle-root.js`
3. Modified `copySharedAgents`, `copySkillManifests`, `copyGuidelineManifests`, `copyHooks`, `copyTemplates` to accept `bundleRoot: string` as first parameter
4. Updated each copy function to use `Path.join(bundleRoot, "<subdir>")` instead of `Path.join(PROJECT_ROOT, "bundle", "<subdir>")`
5. In `setupHamilton()`, resolved bundleRoot once before copy calls using `Effect.try` to catch `BundleRootNotFoundError` and wrap it in `SetupError`
6. Passed `bundleRoot` to each copy function call

**Tests**:
- Added new test "uses HAMILTON_BUNDLE_DIR env var to locate bundle assets" that verifies:
  - Environment variable HAMILTON_BUNDLE_DIR is respected
  - Bundle assets are copied from temp directory when env var is set
  - Proper cleanup of env var in afterEach

**Verification**:
- ✅ `bun --bun vitest run tests/cli/setup.test.ts -t "bundle root resolution"` → new test passes
- ✅ All pre-existing setup.ts copy-related tests still pass (27 passing tests for relevant functionality)
- ✅ `bun run build` → clean build (no type errors)
- ✅ `setupHamilton()` properly wraps BundleRootNotFoundError in SetupError via Effect.try catch handler

**Notes**:
- Three pre-existing test failures in setup.test.ts are unrelated to this task (workflow naming inconsistencies and timeout issues)
- Implementation matches plan specification exactly
- Error handling properly converts resolveBundleRoot() exceptions to SetupError as required
- All copy functions still maintain their original logic, only the source path resolution changed

---

## Task 3: Wire `install-logic.ts` to `resolveBundleRoot()`

**Status**: ⏳ Pending

---

## Task 4: Add the release workflow (`.github/workflows/release.yml`)

**Status**: ⏳ Pending

---

## Task 5: Rewrite `install.sh` for binary-based installs

**Status**: ⏳ Pending

---

## Task 6: Update README and CONTRIBUTING

**Status**: ⏳ Pending
