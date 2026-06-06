# Hamilton Bun Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Hamilton from npm/Node.js to bun by replacing `better-sqlite3` with `bun:sqlite`, switching package manager, and adding `install-local`/`purge` scripts.

**Architecture:** Replace the C++ native `better-sqlite3` addon with bun's built-in `bun:sqlite` module (near-identical API). Remove npm lockfile, switch to bun lockfile. Pin all dependency versions. Add convenience scripts for local install and full teardown.

**Tech Stack:** bun, TypeScript, Effect-TS, bun:sqlite, vitest (unchanged)

---

### File Structure

**Modify:**
- `src/db/schema.ts` — import + pragma + type annotation (3 changes)
- `src/db/queries.ts` — import + 16x `Database.Database` → `Database` type annotations
- `src/workflow/state.ts` — import + pragma + type annotation (3 changes)
- `src/workflow/run-state-machine.ts` — import + 3x `Database.Database` → `Database`
- `tests/db/schema.test.ts` — import + 3x type annotations
- `tests/db/queries.test.ts` — import + 3x type annotations
- `tests/cli/status.test.ts` — import + 3x type annotations
- `package.json` — remove 2 deps, pin 2 versions, add 2 scripts, remove `engines.node`
- `.gitignore` — add `bun.lockb`

**Delete:**
- `package-lock.json`

---

### Task 1: Migrate better-sqlite3 → bun:sqlite in src/ files

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/queries.ts`
- Modify: `src/workflow/state.ts`
- Modify: `src/workflow/run-state-machine.ts`

- [ ] **Step 1: Update `src/db/schema.ts`**

Change line 1:
```
import Database from "better-sqlite3"
```
→
```
import { Database } from "bun:sqlite"
```

Change line 3:
```
export function createSchema(db: Database.Database): void {
```
→
```
export function createSchema(db: Database): void {
```

No other changes — `db.exec()` exists in both libraries.

- [ ] **Step 2: Update `src/db/queries.ts`**

Change line 1:
```
import Database from "better-sqlite3"
```
→
```
import { Database } from "bun:sqlite"
```

Replace all `Database.Database` with `Database` (16 occurrences on lines 52, 63, 76, 90, 103, 114, 127, 137, 146, 150, 154, 187, 198, 209, 221, 231). Use find-and-replace: `Database.Database` → `Database`.

No other changes — `.prepare().run()`, `.prepare().get()`, `.prepare().all()` all have identical APIs.

- [ ] **Step 3: Update `src/workflow/state.ts`**

Change line 2:
```
import Database from "better-sqlite3"
```
→
```
import { Database } from "bun:sqlite"
```

Change line 34:
```
export function openDb(): Effect.Effect<Database.Database, RunStateError> {
```
→
```
export function openDb(): Effect.Effect<Database, RunStateError> {
```

Change line 39 (the pragma call):
```
db.pragma("journal_mode = WAL")
```
→
```
db.run("PRAGMA journal_mode = WAL")
```

- [ ] **Step 4: Update `src/workflow/run-state-machine.ts`**

Change line 2:
```
import Database from "better-sqlite3"
```
→
```
import { Database } from "bun:sqlite"
```

Change line 52:
```
readonly db: Database.Database
```
→
```
readonly db: Database
```

Change line 71:
```
private readonly _db: Database.Database,
```
→
```
private readonly _db: Database,
```

Change line 81:
```
get db(): Database.Database { return this._db }
```
→
```
get db(): Database { return this._db }
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1
```

Expected: Some type errors from `bun:sqlite` type differences are possible. If `bun:sqlite` types are stricter on `.prepare()` return types, you may need to adjust. The key thing is that `Database` is properly recognized as a type.

If `bun:sqlite` types are not available (because bun isn't installed yet), this step will fail with "Cannot find module 'bun:sqlite'". That's expected — Task 3 installs bun and fixes this.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/queries.ts src/workflow/state.ts src/workflow/run-state-machine.ts
git commit -m "feat: migrate better-sqlite3 imports to bun:sqlite in src/ files"
```

---

### Task 2: Migrate better-sqlite3 → bun:sqlite in test files

**Files:**
- Modify: `tests/db/schema.test.ts`
- Modify: `tests/db/queries.test.ts`
- Modify: `tests/cli/status.test.ts`

- [ ] **Step 1: Update `tests/db/schema.test.ts`**

Change line 2:
```
import Database from "better-sqlite3"
```
→
```
import { Database } from "bun:sqlite"
```

Change line 8:
```
function tempDb(): Database.Database {
```
→
```
function tempDb(): Database {
```

Change line 17:
```
function cleanupDb(db: Database.Database) {
```
→
```
function cleanupDb(db: Database) {
```

Change line 24 (or wherever `let db:` is declared):
```
let db: Database.Database
```
→
```
let db: Database
```

- [ ] **Step 2: Update `tests/db/queries.test.ts`**

Same pattern as above — replace `import Database from "better-sqlite3"` → `import { Database } from "bun:sqlite"` and all `Database.Database` → `Database` (3 occurrences: `tempDb()` return type, `cleanupDb()` parameter type, `let db` declaration).

- [ ] **Step 3: Update `tests/cli/status.test.ts`**

Same pattern — replace import and all `Database.Database` → `Database` (3 occurrences).

- [ ] **Step 4: Commit**

```bash
git add tests/db/schema.test.ts tests/db/queries.test.ts tests/cli/status.test.ts
git commit -m "feat: migrate better-sqlite3 imports to bun:sqlite in test files"
```

---

### Task 3: Update package.json, .gitignore, and install bun deps

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Delete: `package-lock.json`

- [ ] **Step 1: Update `package.json`**

The new `package.json` dependencies and scripts:

```json
{
  "name": "hamilton",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "bin": {
    "hamilton": "dist/cli/main.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "install-local": "bun run build && bun link",
    "purge": "bun unlink hamilton; rm -rf ~/.hamilton/"
  },
  "dependencies": {
    "@earendil-works/pi-agent-core": "0.78.1",
    "@earendil-works/pi-ai": "0.78.1",
    "@earendil-works/pi-coding-agent": "0.78.1",
    "@effect/schema": "0.75.5",
    "@effect/workflow": "0.18.2",
    "effect": "3.21.3",
    "yaml": "2.4.5"
  },
  "devDependencies": {
    "@effect/vitest": "0.29.0",
    "@types/node": "22.16.0",
    "typescript": "5.9.3",
    "vitest": "4.1.8"
  }
}
```

Changes from current:
- Removed `"engines": { "node": ">=22" }` — bun is the runtime now
- Removed `"@types/better-sqlite3": "^7.6.13"` — bun:sqlite ships types
- Removed `"better-sqlite3": "^11.10.0"` — replaced by bun:sqlite
- Pinned `"@earendil-works/pi-ai": "^0.78.1"` → `"0.78.1"`
- Pinned `"@earendil-works/pi-coding-agent": "^0.78.1"` → `"0.78.1"`
- Added `"install-local"` script
- Added `"purge"` script

- [ ] **Step 2: Update `.gitignore`**

Add `bun.lockb` to the end of `.gitignore`.

- [ ] **Step 3: Delete package-lock.json**

```bash
rm package-lock.json
```

- [ ] **Step 4: Delete node_modules and install with bun**

```bash
rm -rf node_modules && bun install 2>&1
```

Expected: `bun.lockb` generated, all deps installed.

- [ ] **Step 5: Verify TypeScript compiles with bun**

```bash
bun run build 2>&1
```

Expected: Clean build. If `bun:sqlite` types differ from `better-sqlite3` in subtle ways, you may need to adjust type annotations. Common issues:
- `.prepare()` return type may be `Statement` instead of `Database.Statement`
- `.run()` return shape may differ (`{ changes }` vs `{ changes, lastInsertRowid }`)

If there are type errors, fix them and re-run `bun run build`.

- [ ] **Step 6: Run tests**

```bash
bun test 2>&1 || bunx vitest run 2>&1
```

Note: `bun test` uses bun's native test runner which is NOT what we want — we want vitest. Run:
```bash
bunx vitest run 2>&1
```

Expected: All 133 tests pass.

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore && git rm package-lock.json && git commit -m "feat: switch to bun, add install-local and purge scripts"
```

---

### Task 4: Full end-to-end verification

- [ ] **Step 1: Run tests**

```bash
bunx vitest run 2>&1
```

Expected: 133 tests pass.

- [ ] **Step 2: Build**

```bash
bun run build 2>&1
```

Expected: Clean build, no TypeScript errors.

- [ ] **Step 3: Test install-local**

```bash
bun run install-local 2>&1
```

Expected: Build succeeds, `hamilton` becomes available globally. Verify:

```bash
which hamilton && hamilton 2>&1 | head -3
```

Expected: Shows hamilton path and help output.

- [ ] **Step 4: Test init**

```bash
TMP_HOME=$(mktemp -d) && env HOME=$TMP_HOME hamilton init 2>&1 && echo "---" && ls $TMP_HOME/.hamilton/ && rm -rf $TMP_HOME
```

Note: If async output doesn't flush, test via vitest instead — the init tests already verify this end-to-end:

```bash
bunx vitest run tests/cli/init.test.ts 2>&1
```

Expected: 9 tests pass.

- [ ] **Step 5: Test purge**

```bash
bun run purge 2>&1 && echo "---" && ls ~/.hamilton/ 2>&1 || echo "Directory removed (expected)"
```

Expected: `~/.hamilton/` removed, `hamilton` command no longer available globally.

- [ ] **Step 6: Re-install and verify clean**

```bash
bun run install-local 2>&1 && hamilton init 2>&1
```

Expected: Fresh install + init works after purge.