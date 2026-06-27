# Use Cases

Practical patterns for using Hamilton in software development workflows.

## Bug Fixing

Hamilton's primary use case. A structured pipeline from triage to verified fix.

### Basic Bug Fix

```bash
cd /path/to/repo
hamilton workflow run bug-fix "The checkout page crashes when quantity exceeds 999"
```

**Pipeline**: triage → investigate → setup → fix → verify

**What happens:**
1. Triager explores the codebase, reproduces the crash, classifies severity
2. Investigator traces the root cause (e.g., integer overflow in the quantity field)
3. Setup creates a bugfix branch, discovers build/test commands
4. Fixer implements the fix with a regression test
5. Verifier runs the full test suite, confirms the regression test actually tests the bug, checks for side effects

**Output** (in `~/.hamilton/runs/<id>/task-outputs/`):
- Triage report with severity, reproduction steps, affected files
- Root cause analysis with fix approach
- Git diff with the actual fix and regression test
- Verification report confirming all tests pass

**Typical duration**: 2-5 minutes depending on repo size and bug complexity.

### Bug Fix with GitHub PR

```bash
hamilton workflow run bug-fix "Fix the auth token expiry handling" --variants branchout,github_pr
# or equivalently:
hamilton workflow run bug-fix-github-pr "Fix the auth token expiry handling"
```

Adds a PR creation task at the end. The PR agent creates a well-structured pull request with:
- Descriptive title from the bug report
- Body with problem statement, root cause, fix approach, and changes
- Link to the fix commit

### Bug Fix with Squash-Merge

```bash
hamilton workflow run bug-fix "Fix memory leak in WebSocket handler" --variants branchout,merge
```

After verification, squash-merges the fix branch back to the original branch.

### Bug Fix in Isolated Worktree

```bash
hamilton workflow run bug-fix-worktree "Fix race condition in cache invalidation"
```

Creates a git worktree (isolated directory) so the bug fix doesn't touch the current
working directory. Useful when you want to keep working on something else while Hamilton
fixes a bug.

---

## Feature Development

For implementing features from a specification. Story-based decomposition with
per-story implementation and verification.

### Local-Only Feature Development

```bash
cd /path/to/repo
hamilton workflow run feature-dev "Add a dark mode toggle to the user settings page"
```

**Pipeline**: plan → setup → implement-stories* → verify-stories* → test

\* forEach over plan stories

**What happens:**
1. Planner explores the codebase and decomposes the spec into ordered stories
2. Setup discovers build/test commands and creates the feature branch
3. Developer implements each story one at a time, with tests, on the feature branch
4. Verifier checks each story's acceptance criteria
5. Tester runs integration/E2E tests across all stories

**The forEach advantage**: The planner's output (an array of stories) drives the
implementation loop. Each story gets a fresh agent session with full context. The
developer agent reads the progress file to understand completed stories and discovered
codebase patterns.

### Full Feature Pipeline (with PR)

```bash
hamilton workflow run feature-dev-github-pr "Add user profile picture upload with cropping"
```

Adds: branch creation, PR creation, and an optional code review step.

### Progress Tracking

The developer and verifier agents maintain a progress file at
`./.hamilton/workflows/progress-<YYYY-MM-DD>.txt`:

```markdown
# Progress Log

---

## 2025-06-15T10:35:00Z — developer (claude-sonnet-4)

- Implemented story #1: Add database schema for profile pictures
- Created migration file, model, and repository
- Tests pass: 12 new tests for CRUD operations

**Codebase Patterns:**
- Migrations use timestamp-based naming: YYYYMMDDHHMMSS_description.sql
- Models extend BaseModel with createdAt/updatedAt
- Repositories follow the DataMapper pattern

---

## 2025-06-15T10:38:00Z — developer (claude-sonnet-4)

- Implemented story #2: Add file upload endpoint
- Created upload controller, middleware, S3 integration
- Tests pass: 8 new tests for upload flow

**Codebase Patterns:**
- Controllers use dependency injection via constructor
- File validation uses the shared FileValidator service
```

This file is read by subsequent agent sessions, providing continuity and preventing
duplicated effort.

---

## Security Auditing

For proactive vulnerability scanning and remediation.

```bash
cd /path/to/repo
hamilton workflow run security-audit "Audit the payment processing module"
```

**Pipeline**: scan → prioritize → setup → fix-stories* → verify-stories* → test

**What happens:**
1. Scanner runs `npm audit`, scans for hardcoded secrets, checks for common
   vulnerabilities (SQLi, XSS, CSRF, auth bypass, path traversal, SSRF), reviews
   auth/session handling, checks security headers
2. Prioritizer deduplicates findings, groups related issues, ranks by severity,
   creates a fix plan
3. Setup creates a security branch and establishes baseline
4. Fixer implements each fix with regression tests
5. Verifier applies security-specific verification (bypass-scenario thinking)
6. Tester runs full suite, compares npm audit before/after, smoke tests

**Security-specific verification includes**:
- Testing multiple payload variants (not just the one found)
- Checking all HTTP methods for auth bypass
- Handling URL-encoded sequences for path traversal
- Verifying sanitization across HTML, attributes, JS, and URL contexts for XSS

---

## Test Quarantine

For establishing a clean baseline when a test suite has known failures.

```bash
cd /path/to/repo
hamilton workflow run quarantine-broken-tests "Quarantine the 15 failing integration tests"
```

**Pipeline**: setup → quarantine → verify

**Use case**: You inherit a repo with failing tests. Before starting feature work, you
need a clean baseline. Hamilton identifies failing tests and disables them minimally
(.skip, decorator, or comment) while preserving the test logic for future fixing.

**What happens:**
1. Setup discovers build/test commands and runs the baseline suite (recording failures)
2. Quarantiner runs tests, identifies failures, disables them, reruns, iterates until
   all pass (max 5 iterations)
3. Verifier confirms the suite is green, only test files were modified, and each
   disabled test has an explanatory comment

**Safety**: The quarantiner never modifies or deletes test logic. It only adds
skip/disable markers. The verifier confirms this.

---

## Greenfield Projects

For scaffolding new projects from scratch.

```bash
hamilton workflow run scaffold "Create a Next.js blog with MDX support and Tailwind CSS"
```

**Pipeline**: scaffold → verify

**What happens:**
1. Scaffolder creates the project directory, initializes git, sets up the tech stack
   (Next.js + Tailwind + MDX), creates directory structure, writes README, configures
   package.json, creates .gitignore, writes a minimal entry point
2. Verifier confirms the project is buildable, has proper structure, and is initialized

Unlike other workflows, `scaffold` doesn't need an existing git repo.

---

## General-Purpose Tasks

Use the `do` workflow for one-off tasks where a single agent is sufficient.

### Basic Do

```bash
cd /path/to/repo
hamilton workflow run do "Add JSDoc comments to all exported functions in src/utils/"
```

**Pipeline**: setup → do

**What happens:**
1. Setup discovers build and test commands
2. The `do` agent understands the task, plans an approach, executes, verifies, and reports

**Output**: A JSON object with `status`, `result` (what was done), and `changes` (list of changed files).

### Do with Guidelines

The `do` agent automatically picks up project guidelines based on file types. To add custom conventions:

1. Create `~/.hamilton/guidelines/my-conventions/guideline.yml`
2. The `do` agent will follow your conventions alongside the task prompt

### When to Use Do vs. Bug-Fix

| Use `do` when... | Use `bug-fix` when... |
|------------------|-----------------------|
| The task doesn't need separate triage/analysis phases | You need structured root cause analysis |
| A single agent can complete the work | Multiple agents with different expertise are needed |
| You want to add/refactor code (not fix a specific bug) | You're fixing a reported defect |
| The outcome is additive (docs, features, refactors) | The outcome needs verification against acceptance criteria |

---

## Combining Workflows

Hamilton workflows can be composed manually through sequential runs. For example,
a full QA pipeline:

```bash
# 1. First, quarantine broken tests to get a clean baseline
hamilton workflow run quarantine-broken-tests "Quarantine broken tests on main"

# 2. Audit security before starting feature work
hamilton workflow run security-audit "Audit the codebase for vulnerabilities"

# 3. Develop the feature story-by-story
hamilton workflow run feature-dev-github-pr "Add two-factor authentication"

# 4. Fix bugs discovered during development
hamilton workflow run bug-fix "2FA setup page crashes on mobile Safari"
```

Note: Triggering workflows from other workflows is on the roadmap but not yet implemented.

---

## Monitoring and Intervention

### Monitoring Background Runs

```bash
# Start a long-running feature development in the background
hamilton workflow run feature-dev "Add GraphQL API for user profiles"

# In another terminal, check status
hamilton workflow runs --status running
hamilton workflow status feature-dev-xk93m

# Watch logs in real time
hamilton workflow logs feature-dev-xk93m -f

# If something looks wrong, pause
hamilton workflow pause feature-dev-xk93m

# Review task outputs before deciding to resume
ls ~/.hamilton/runs/feature-dev-xk93m/task-outputs/

# Resume or let it escalate to human
hamilton workflow resume feature-dev-xk93m
```

### Intervention Points

You can intervene at any point:

1. **Pause** -- stops after current task. State preserved in SQLite.
2. **Review outputs** -- read `task-outputs/` JSON files to see what agents produced
3. **Resume** -- continues from where it stopped
4. **Natural escalation** -- if all retries are exhausted, the run transitions to
   `failed` with `escalate_to: human`. Review the error and decide.

### Progress File as Context

The progress file (`./.hamilton/workflows/progress-<date>.txt`) serves as long-term memory
across runs. After a workflow completes, the progress file contains:

- Completed stories with implementation notes
- Discovered codebase patterns and conventions
- Build/test commands and CI notes
- Known issues and decisions

This file is read by agents in subsequent runs, providing continuity without depending on
run-specific SQLite data.
