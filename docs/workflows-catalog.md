# Workflows Catalog

> ⚠️ **Autonomous mode (experimental).** This documents Hamilton's workflow engine, which is under active rework and can change without notice. See [The three modes](./modes.md). For the working path today, use [Assisted mode](./skills.md).

All bundled workflows. Each is installed to `~/.hamilton/workflows/<slug>/` by `hamilton setup`.

---

## bug-fix

**Triage, investigate, and fix bugs with automated verification.**

| Property | Value |
|----------|-------|
| Version | 2 |
| Tasks | 5 |
| Agents | triager, investigator, setup, fixer, verifier |
| Variants | branchout, merge, worktree, github_pr |

### DAG

```
triage → investigate → setup → fix → verify
```

### Task Details

| Task | Agent | Purpose |
|------|-------|---------|
| `triage` | triager | Explores codebase, reproduces issue, classifies severity (critical/high/medium/low), documents findings |
| `investigate` | investigator | Traces root cause, documents what's wrong and why, proposes fix approach |
| `setup` | setup (shared) | Creates bugfix branch, discovers build/test commands, establishes baseline, ensures .gitignore |
| `fix` | fixer | Implements the fix based on root cause and fix approach, writes regression test, commits |
| `verify` | verifier (shared) | Runs test suite, verifies regression test, reviews fix correctness, checks for side effects |

### Context Flow

```
triage       →  repo, branch, severity, affected_area, reproduction, problem_statement
investigate  →  root_cause, fix_approach
setup        →  build_cmd, test_cmd, baseline
fix          →  changes, regression_test
verify       →  verified
```

### Variant Suffixes

| Slug | Variants | Adds |
|------|----------|------|
| `bug-fix` | (none) | Local-only, no merge |
| `bug-fix-worktree` | worktree | Isolated git worktree |
| `bug-fix-merge` | branchout, merge | Branch + squash-merge |
| `bug-fix-merge-worktree` | worktree, merge | Worktree + merge |
| `bug-fix-github-pr` | branchout, github_pr | Branch + PR (6 tasks, adds `pr` agent at end) |

---

## feature-dev

**Plan, implement, test, and verify features story-by-story.**

| Property | Value |
|----------|-------|
| Version | 6 |
| Tasks | 6 (2 template tasks expanded via forEach) |
| Agents | planner, setup (shared), developer, verifier (shared), tester |
| Variants | branchout, merge, worktree, github_pr |

### DAG

```
plan → setup → implement-stories* → verify-stories* → test
```

\* `implement-stories` and `verify-stories` are template/forEach tasks. They expand into
N instances, one per story from the plan output.

### Task Details

| Task | Agent | Type | Purpose |
|------|-------|------|---------|
| `plan` | planner | agent | Decomposes spec into max 20 ordered stories with acceptance criteria |
| `setup` | setup (shared) | agent | Discovers build/test commands, creates feature branch, establishes baseline |
| `implement-stories` | developer | forEach | Iterates over plan stories, implements one per session with tests |
| `implement-story` | developer | template | Template for each story: implement, test, commit, update progress |
| `verify-stories` | verifier (shared) | forEach | Iterates over plan stories, verifies each |
| `verify-story` | verifier (shared) | template | Template for each story: check code exists, acceptance criteria, tests pass |
| `test` | tester | agent | Integration/E2E testing, cross-story validation |

### Context Flow

```
plan                →  stories_json (array), repo, branch
setup               →  build_cmd, test_cmd, current_branch, baseline
implement-story/0   →  changes, tests
implement-story/1   →  changes, tests
...
verify-story/0      →  verified / issues
verify-story/1      →  verified / issues
...
test                →  results
```

### forEach Mechanics

The `plan` task outputs a `tasks` array (or `stories_json`). The `implement-stories` task
expands one instance per story:

```yaml
- name: implement-stories
  dependencies: [setup]
  template: implement-story
  arguments:
    forEach:
      valueFrom:
        ref: inputs.tasks.plan.outputs.tasks
      as: current_task
```

Each instance has `inputs.parameters.current_task` containing the story object. The
`verify-stories` task does the same for the verify phase.

### Visual Verification

The `verify-story` template includes a conditional visual verification phase for frontend
changes. If the story has `has_frontend_changes: true`, the verifier opens the UI in a browser
via the `agent-browser` skill, takes a screenshot, and visually confirms layout, styling, and
element visibility.

### Progress Tracking

The developer and verifier agents read and write a progress file at
`./.hamilton/workflows/progress-<YYYY-MM-DD>.txt` that tracks completed stories and discovered
codebase patterns. This provides context continuity across multiple agent sessions.

---

## do

**Single general-purpose agent for arbitrary tasks.**

| Property | Value |
|----------|-------|
| Version | 2 |
| Tasks | 1 |
| Agents | doer |
| Variants | none |

### DAG

```
execute
```

The simplest workflow. One task, one agent, end-to-end execution. Use when you don't need a
multi-step pipeline:

```bash
hamilton workflow run do "Refactor the auth module to use the new token format"
```

The doer agent understands the task, plans an approach, executes step by step, and reports
results. No decomposition into subtasks -- the agent handles everything in one session.

### Task Details

| Task | Agent | Purpose |
|------|-------|---------|
| `execute` | doer | Understands task, plans approach, executes, verifies, reports |

---

## security-audit

**Scan, prioritize, and fix security vulnerabilities with automated verification.**

| Property | Value |
|----------|-------|
| Version | 2 |
| Tasks | 7 (2 template tasks expanded via forEach) |
| Agents | scanner, prioritizer, setup (shared), sec-fixer, verifier (shared), sec-tester |
| Variants | branchout, merge, worktree, github_pr |

### DAG

```
scan → prioritize → setup → fix-stories* → verify-stories* → test
```

### Task Details

| Task | Agent | Purpose |
|------|-------|---------|
| `scan` | scanner | Comprehensive security scan: npm audit, hardcoded secrets, common vulnerabilities (SQLi, XSS, CSRF, auth bypass, path traversal, SSRF, insecure deserialization, missing validation), security headers |
| `prioritize` | prioritizer | Deduplicates findings, groups related issues, ranks by exploitability x impact, creates prioritized fix plan (max 20 stories) |
| `setup` | setup (shared) | Creates security branch, discovers build/test commands, establishes baseline |
| `fix-stories` | sec-fixer | forEach over prioritized stories: implements fix, writes regression test, commits |
| `fix-story` | sec-fixer | template |
| `verify-stories` | verifier (shared) | forEach over stories: verifies correctness with security-specific bypass-scenario thinking |
| `verify-story` | verifier (shared) | template |
| `test` | sec-tester | Final integration: full test suite, npm audit comparison, smoke test, regression check |

### Security-Specific Verification

The verifier in security workflows includes bypass-scenario thinking for each vulnerability type:

- **SQL Injection**: Does the fix handle all query patterns, not just the one found?
- **XSS**: Does sanitization cover HTML, attributes, JS, and URL contexts?
- **Path traversal**: Does it handle URL-encoded sequences (`%2e%2e`) and null bytes?
- **Auth bypass**: Does it cover all HTTP methods (GET, POST, PUT, DELETE)?
- **CSRF**: Does it validate the token server-side?
- **If the fix only blocks one payload variant**: STATUS: retry

---

## quarantine-broken-tests

**Detect failing tests, disable them minimally, iterate until suite passes.**

| Property | Value |
|----------|-------|
| Version | 2 |
| Tasks | 3 |
| Agents | setup (shared), quarantiner, qa-verifier |
| Variants | branchout, merge, worktree |

### DAG

```
setup → quarantine → verify
```

### Task Details

| Task | Agent | Purpose |
|------|-------|---------|
| `setup` | setup (shared) | Discovers build/test commands, establishes baseline with initial test results |
| `quarantine` | quarantiner | Runs test suite, identifies failures, disables with least invasive technique (.skip, decorator, comment), iterates until all pass (max 5 iterations) |
| `verify` | qa-verifier | Confirms all tests pass, runs twice for stability, verifies only test files modified, checks explanatory comments on disabled tests |

### Quarantine Heuristics

- If zero failures on first run, run again to catch flaky tests
- Disable by `.skip` (Jest/Vitest), decorator (pytest), or comment (unittest)
- Never modify or delete test logic -- only disable
- Max 5 iterations, then report failure with reason
- Commit message: `chore: quarantine broken tests` with `Co-Authored-By: Hamilton`

---

## scaffold

**Scaffold a new project from scratch.**

| Property | Value |
|----------|-------|
| Version | 2 |
| Tasks | 2 |
| Agents | scaffolder, verifier (shared) |
| Variants | none |

### DAG

```
scaffold → verify
```

### Task Details

| Task | Agent | Purpose |
|------|-------|---------|
| `scaffold` | scaffolder | Creates project directory, inits git, creates directory structure for tech stack, writes README.md, creates config files (package.json/pyproject.toml/Cargo.toml), creates .gitignore, creates minimal entry point, commits |
| `verify` | verifier (shared) | Confirms directory exists, README has name+description, .gitignore is appropriate, build command works, git is initialized |

Unlike other workflows, `scaffold` creates a new project from scratch -- no existing git repo
is required (though it will create one). The user prompt specifies project name, tech stack,
and description.

---

## script-example

**Demonstrates script tasks (shell commands, zero LLM tokens).**

| Property | Value |
|----------|-------|
| Version | 1 |
| Tasks | 3 |
| Agents | none |
| Variants | none |

### DAG

```
install-deps → build → test
```

### Task Details

| Task | Type | Command |
|------|------|---------|
| `install-deps` | script | `npm install` (retries: 2) |
| `build` | script | `npm run build` |
| `test` | script | `npm test` (retries: 3) |

This is a reference workflow for the script task pattern. All tasks execute shell commands
directly -- no AI agents are involved. Use as a template for CI/CD-like pipelines within Hamilton.

---

## Variant Suffix Reference

Each base workflow generates multiple installed variants:

| Base Workflow | Variants |
|---------------|----------|
| bug-fix | bug-fix, bug-fix-worktree, bug-fix-merge, bug-fix-merge-worktree, bug-fix-github-pr |
| feature-dev | feature-dev, feature-dev-worktree, feature-dev-merge, feature-dev-merge-worktree, feature-dev-github-pr |
| security-audit | security-audit, security-audit-worktree, security-audit-merge, security-audit-merge-worktree, security-audit-github-pr |
| quarantine-broken-tests | quarantine-broken-tests, quarantine-broken-tests-merge, quarantine-broken-tests-merge-worktree |
| do | do (no variants) |
| scaffold | scaffold (no variants) |
| script-example | script-example (no variants) |

### Variant Legend

| Suffix | Behavior |
|--------|----------|
| (none) | Local-only. Work happens in the current repo directory. No branch creation, no merge, no PR. |
| `-worktree` | Creates an isolated git worktree. Changes don't affect the main working directory. |
| `-merge` | Creates a branch, then squash-merges at the end. All commits are squashed into one. |
| `-merge-worktree` | Worktree + squash-merge. Isolated workspace with merge at completion. |
| `-github-pr` | Creates a branch, then opens a GitHub pull request. Adds a PR creation task at the end. |

To use variants explicitly rather than variant suffixed workflows:

```bash
hamilton workflow run bug-fix "Fix crash" --variants branchout,github_pr
```
