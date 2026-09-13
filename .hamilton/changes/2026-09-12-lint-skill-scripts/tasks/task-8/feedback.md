---
artifact: feedback
change: 2026-09-12-lint-skill-scripts
task: 8
created: 2026-09-13
status: open
verdict: changes-requested
decision: accepted
base: 22d8d1a6a78717344b36350f160b9171480168b7
head: e66d9aac9e7410219a866d7d92b18484f77f04ad
---

# Code Feedback: Task 8 — Port change context

## Pass 1 — 2026-09-13

### Blocking

- [src/workbench/context.ts:990-1000, 1049-1063] Invalid or contract-invalid frontmatter in feedback.md or review.md enters the legacy body-parser branches instead of being rejected, so a malformed current artifact with a legacy-shaped body can be reported with a valid verdict and freshness. Branch only for an unrelated artifact result and return `malformed` for invalid recognized input (violates: current frontmatter artifacts use shared typed inspection; malformed artifacts fail closed without silent reinterpretation).
- [src/workbench/context.ts:562-572] A recognized current proposal or plan whose authoritative `route_unit` is null or absent is still parsed for a legacy route table in its Markdown body, allowing body metadata to override or invent current route metadata. Restrict the body fallback to unrelated/legacy artifacts and leave route metadata absent when recognized frontmatter does not provide it (violates: frontmatter is authoritative and context body parsing is limited to legacy classification).
- [src/workbench/context.ts:1254-1266] `contextAll` does not catch failures from `readDirectory(changesDir)` or per-entry directory checks, so an unreadable changes directory can reject the operation instead of returning the required exit-2 environment error. Catch discovery I/O failures and convert them to an `all` error result without emitting successful context output (violates: invalid paths and unreadable changes return environment errors).

### Suggestions

- None.
