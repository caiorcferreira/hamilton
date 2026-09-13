---
artifact: feedback
change: 2026-09-12-lint-skill-scripts
task: 5
created: 2026-09-13
status: open
verdict: changes-requested
decision: rejected
base: 3b36739a9e35e8e35e132b064d501df35dfad533
head: f898e8cab1b60eda66884f61839c65a969c07a14
---

# Code Feedback: Task 5 — Establish runtime seams for isolation

## Pass 1 — 2026-09-13

### Blocking

- [src/workbench/isolate.ts:183-195, 250-252, 330] `check`, `create`, and `verify` obtain their repository cwd directly from `process.cwd()`, while the injected `IsolationRuntime` has no cwd port. This leaves a mutable process-global effect in isolation policy and prevents callers or tests from selecting the operation cwd through the runtime seam; add a narrow injected cwd/input seam and route all three operations through it (violates: runtime-seam acceptance criterion; design Dependency inversion and Quality Lens Boundaries and dependencies).

### Suggestions

- None.
