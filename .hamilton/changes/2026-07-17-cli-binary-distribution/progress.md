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

**Status**: ⏳ Pending

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
