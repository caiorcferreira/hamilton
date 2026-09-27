---
artifact: task-progress
change: 2026-09-25-replace-effect-cli-with-nestjs
task: 22
status: done
updated: 2026-09-27
decision: accepted
---
# Task Progress: Task 22 — Smoke-test standalone binaries

## Attempt 1 — 2026-09-27

- Outcome: done
- Created:
  - `scripts/smoke-standalone.sh`
- Modified:
  - `.github/workflows/release.yml`
  - `.hamilton/changes/2026-09-25-replace-effect-cli-with-nestjs/plan.md`
  - `.hamilton/changes/2026-09-25-replace-effect-cli-with-nestjs/progress.md`
  - `.hamilton/changes/2026-09-25-replace-effect-cli-with-nestjs/tasks/task-22/progress.md`
- Deleted: none
- Verification:
  - Before implementation, the release workflow's four-target matrix compiled binaries with `bun build --compile`; its Linux x64 test step only chmodded the binary and ran `--version`. No standalone smoke script existed.
  - Before implementation, `bun build --compile --target=bun-linux-x64 src/cli/main.ts --outfile /tmp/hamilton-nest-smoke` failed under Bun 1.4.0 with `Could not resolve` for optional imports: `class-transformer` at `@nestjs/common/serializer/class-serializer.interceptor.js:24` and `@nestjs/common/pipes/validation.pipe.js:49`; `class-validator` at `@nestjs/common/pipes/validation.pipe.js:45`; `@nestjs/platform-express` at `@nestjs/core/nest-application.js:419` and `@nestjs/core/nest-factory.js:169`; `@nestjs/microservices` at `@nestjs/core/nest-application.js:420,524` and `@nestjs/core/nest-factory.js:52`; and `@nestjs/websockets/socket-module.js` plus `@nestjs/microservices/microservices-module.js` at `@nestjs/core/nest-application.js:512,520`. `bun install --frozen-lockfile` completed without changing the install graph.
  - Before implementation, this externalized compile passed and produced a 100,725,960-byte Linux x64 executable: `bun build --compile --target=bun-linux-x64 src/cli/main.ts --external=class-transformer --external=class-validator --external=@nestjs/platform-express --external=@nestjs/microservices --external=@nestjs/websockets --outfile /tmp/hamilton-nest-smoke`. Outside the checkout, it passed exact version `0.9.0`, root and workbench help, setup template/guideline asset checks, lint of the staged `cli-distribution.md` fixture (exit 0), and missing-bundle setup (exit 2 with checked paths and no checkout fallback); the stage was cleaned.
  - The amended exact Verify command passed: `bun build --compile --target=bun-linux-x64 --external class-transformer --external class-validator --external @nestjs/platform-express --external @nestjs/microservices --external @nestjs/websockets src/cli/main.ts --outfile /tmp/hamilton-nest-smoke && bash scripts/smoke-standalone.sh /tmp/hamilton-nest-smoke && bun --bun vitest run && bun run build`. The recompiled artifact was 100,725,960 bytes. The script reported exact version, root help, workbench help, setup assets, representative lint, and missing-bundle status 2/no checkout fallback. Vitest passed 40 files and 530 tests; `bun run build` passed.
  - With the host PATH containing Bun and Node and `HAMILTON_BUNDLE_DIR` deliberately set to the checkout bundle, `TMPDIR=<fresh temporary directory> bash scripts/smoke-standalone.sh /tmp/hamilton-nest-smoke` passed; the child CLI had neither executable in its restricted PATH, ignored the override, and the temporary stage directory was empty after exit.
  - `bash -n scripts/smoke-standalone.sh`, `shellcheck scripts/smoke-standalone.sh`, workflow YAML parse/structural checks for all four target pairs and the Linux x64 smoke invocation, and `git diff --check` passed.
  - `hamilton workbench lint --file .hamilton/changes/2026-09-25-replace-effect-cli-with-nestjs/tasks/task-22/progress.md` passed: valid task-progress artifact.
  - `hamilton workbench lint --file .hamilton/changes/2026-09-25-replace-effect-cli-with-nestjs/progress.md` passed: valid progress artifact.
- Notes:
  - The first implementation smoke run rejected the lint fixture at a generic temporary path (`path-mismatch`). The fixture was staged under `.hamilton/specs/cli-distribution.md` and the exact Verify command then passed.
  - The approved Task22 plan amendment is in `.hamilton/changes/2026-09-25-replace-effect-cli-with-nestjs/plan.md`, committed by the parent at `f9ec5d8` before this attempt; it is preserved and not changed by this implementation commit.
  - The stable checkpoint remains `dc03a80192dcdce96faa32d560abdac5197fe191` byte-for-byte. No dependencies were added, and the source `bundle/` was not modified.
  - Only Linux x64 was compiled locally; CI retains all four targets and is responsible for the other platform builds.
