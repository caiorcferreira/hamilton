# Hamilton Documentation Improvement — Design Spec

## Summary

Rebalance Hamilton's documentation set from Reference-heavy (50%) to full Diátaxis coverage by
writing 10 new documents, reorganizing the `docs/` directory by quadrant, extracting contributor
content from user-facing docs, and deleting `advanced.md`. Three sequential phases over ~8-10
working days. Source: the [Diátaxis Gap Analysis](../diatasis-gap-analysis.md).

## Scope

All 14 gaps identified in the gap analysis, organized into 3 phases.

## Approach

Phased Diátaxis restructure with quadrant-based directory layout:

- **Tutorials** in `docs/tutorials/` + `getting-started.md` at root (convention: root for
  discovery, subdir for extended walkthroughs)
- **How-to guides** in `docs/how-to/`
- **Explanation** flat at `docs/` root
- **Reference** flat at `docs/` root

Delete `advanced.md` after extracting its content into dedicated files. Extract
"Documentation Conventions" from `agents.md` into `CONTRIBUTING.md`. Fix all cross-links.

## Final Directory Structure

```
docs/
  getting-started.md              # updated: Next Steps links + Philosophy, LSP links
  philosophy.md                   # now linked from Getting Started
  how-workflows-run.md            # NEW
  variants.md                     # NEW
  model-aliases.md                # NEW
  template-expansion.md           # NEW
  cli-reference.md                # stays
  settings.md                     # updated: LSP autocheck link
  workflow-yaml.md                # stays
  workflows-catalog.md            # stays
  agents.md                       # trimmed: remove "Documentation Conventions"
  telemetry.md                    # NEW — extracted from advanced.md
  mcp.md                          # NEW — extracted from advanced.md
  how-to/
    use-cases.md                  # moved from root
    troubleshooting.md            # NEW
    debugging-runs.md             # NEW
    custom-workflows.md           # NEW — extracted from advanced.md
    operations.md                 # NEW — extracted from advanced.md
    ci-cd-integration.md          # NEW
  tutorials/
    custom-workflow.md            # NEW
    custom-guidelines.md          # NEW
  features/
    lsp-autocheck.md              # now linked from Getting Started + Settings

DELETED:
  advanced.md                     # content distributed into how-to/ + reference/
```

## Phase 1: Structural Cleanup & Quick Wins

**Goal:** Fix existing docs and establish quadrant directories. No net-new content.

| # | Gap | Action | Effort |
|---|-----|--------|--------|
| 7 | Split `advanced.md` | Extract into: `how-to/custom-workflows.md`, `telemetry.md`, `mcp.md`, `how-to/operations.md`. Delete `advanced.md`. | Medium |
| 12 | Philosophy discoverability | Add link from `getting-started.md` (Next Steps) and `README.md`. | Trivial |
| 13 | LSP autocheck discoverability | Add link from `getting-started.md` (LSP table) and `settings.md` (LSP section). | Trivial |
| 14 | Contributor docs in agents.md | Extract "Documentation Conventions" section from `agents.md` into `CONTRIBUTING.md`. Trim `agents.md`. | Trivial |
| — | Create directory structure | `mkdir docs/how-to docs/tutorials`. Move `use-cases.md` → `how-to/`. | Trivial |
| — | Cross-link audit | After all moves and extractions, update every doc's cross-references to point to new locations. | Trivial |

### Phase 1 new files (extracted from existing content)

**`how-to/custom-workflows.md`** — extracted from `advanced.md` §Authoring Custom Workflows
- Create a workflow directory structure
- Write workflow.yml (envelope, runConfig, tasks)
- Create agent personas
- Write schemas
- Install and run
- Troubleshoot common authoring mistakes

**`telemetry.md`** — extracted from `advanced.md` §Telemetry
- Run directory layout
- events.jsonl schema (event types, fields)
- logs/ per-step log files
- step-outputs/ JSON output files
- `--monitor` flag usage

**`mcp.md`** — extracted from `advanced.md` §MCP
- MCP server registration in settings.yaml
- Supported transports
- Agent tool access
- Debugging connectivity

**`how-to/operations.md`** — extracted from `advanced.md` §Operations, state machine, performance
- State machine overview
- Pause and resume
- Purge runs
- Managing disk usage
- Performance characteristics

**Phase 1 exit state:** `advanced.md` gone. Quadrant directories exist. No broken links. All existing docs discoverable via Getting Started.

## Phase 2: New Explanation & How-To Documents

**Goal:** Fill Tutorial and How-to quadrants with critical content.

| # | Gap | Action | Effort |
|---|-----|--------|--------|
| 1 | Troubleshooting | Write `how-to/troubleshooting.md` — problem/solution pairs for init failures, stuck runs, agent errors. | Medium |
| 2 | How workflows run | Write `how-workflows-run.md` — DAG construction, agent resolution, context flow, state transitions. | Small |
| 4 | Variants explained | Write `variants.md` — concept, composition, when to use each. Synthesize from existing docs. | Small |
| 5 | Debugging runs | Write `how-to/debugging-runs.md` — reading events.jsonl, step-outputs/, `--monitor`. | Small |
| 9 | Expand `do` workflow | Add "General-Purpose Tasks" subsection to `how-to/use-cases.md`. | Small |
| — | Cross-link new docs | Add all new docs to Getting Started "Next Steps" and wire into existing reference pages. | Trivial |

### Phase 2 new document outlines

**`how-to/troubleshooting.md`**
- `hamilton init` failures (rtk not found, PATH, permissions)
- Workflow stuck in "running" (process killed, how to resume)
- Agent produces bad/empty output (schema validation, retry behavior)
- `AgentNotFoundError` (wrong slug, missing agent)
- Settings validation errors
- Where to find logs

**`how-workflows-run.md`**
- Lifecycle: load → resolve → execute → persist
- What happens during `hamilton workflow run <slug> <prompt>`
- DAG construction (tasks, dependencies, ordering)
- Agent resolution (two-tier: workflow-local → shared)
- Context flow (template variables, Handlebars, accumulated outputs)
- State machine basics (states, transitions, pause/resume)
- What "done" means

**`variants.md`**
- Concept: suffix on workflow slug
- How variants override the base workflow (YAML merging)
- Composition patterns (e.g. `-github-pr` adds tasks, `-no-fix` removes verification)
- Available variant suffixes table (from `workflows-catalog.md`)
- When to use each variant

**`how-to/debugging-runs.md`**
- Inspecting the run directory
- Reading events.jsonl (event types, timestamps, task outputs)
- Reading step-outputs/ (per-task JSON)
- Using `--monitor` for live output
- Interpreting agent failure feedback
- Resuming a failed/paused run

**Phase 2 exit state:** Four new documents written. `how-to/use-cases.md` expanded. The "what went wrong" path exists (troubleshooting + debugging). Every new page linked from Getting Started.

## Phase 3: Tutorials & Advanced How-To

**Goal:** Heavy-lift content — tutorials and integration docs.

| # | Gap | Action | Effort |
|---|-----|--------|--------|
| 3 | Custom workflow tutorial | Write `tutorials/custom-workflow.md` — end-to-end walkthrough. | Large |
| 6 | Custom guidelines tutorial | Write `tutorials/custom-guidelines.md`. | Medium |
| 10 | forEach/template explanation | Write `template-expansion.md`. | Medium |
| 11 | CI/CD integration | Write `how-to/ci-cd-integration.md`. | Medium |
| — | README refresh | Update README to reflect new structure and link to key new docs. | Small |

### Phase 3 new document outlines

**`tutorials/custom-workflow.md`**
1. Define the problem and desired outcome
2. Design agent roles (who does what)
3. Create agent personas (INSTRUCTIONS.md + SOUL.md + agent.yml)
4. Write the workflow YAML (tasks, dependencies, prompts)
5. Create output schemas
6. Install (`hamilton workflow install`)
7. Run and verify
8. Add a variant
9. Iterate (add tasks, adjust prompts, refine schemas)

**`tutorials/custom-guidelines.md`**
- What guidelines are and when to use them
- Step 1: Create `guidelines/custom.md`
- Step 2: Register in settings.yaml
- Step 3: Test with a `do` run
- Step 4: Iterate on guide content

**`template-expansion.md`**
- `{{variable}}` syntax and resolution
- Where variables come from (task outputs, workflow inputs)
- forEach: iterating over lists
- Context propagation: downstream tasks see upstream outputs
- Nested template resolution
- Common pitfalls

**`how-to/ci-cd-integration.md`**
- Hamilton in non-interactive environments
- Exit codes and their meanings
- Capturing JSON output for CI tooling
- GitHub Actions example (checkout, install, run, verify)
- GitLab CI example
- Common CI failure modes

**Phase 3 exit state:** Full Diátaxis coverage. Tutorial quadrant: 3 entries (Getting Started + 2 tutorials). How-to: 5 pages (troubleshooting, debugging, custom-workflows, operations, ci-cd). Explanation: 5 pages (philosophy, how-workflows-run, variants, model-aliases, template-expansion). Reference: 7 pages unchanged.

## Cross-Link Map

After Phase 3, the knowledge progression from Getting Started:

```
Getting Started
  ├── how-workflows-run.md      (understand what you just ran)
  ├── how-to/use-cases.md       (applied patterns)
  ├── variants.md               (concept)
  ├── workflow-yaml.md           (reference)
  ├── cli-reference.md           (reference)
  ├── agents.md                  (reference)
  ├── how-to/troubleshooting.md  (help when things fail)
  ├── how-to/debugging-runs.md   (inspect failures)
  ├── philosophy.md              (design rationale)
  ├── tutorials/custom-workflow.md  (build your own)
  ├── tutorials/custom-guidelines.md (extend with conventions)
  └── how-to/ci-cd-integration.md   (automate)
```

## Design Constraints

- **No comments in any doc file** — match the codebase convention of zero comments
- **Match existing format** — tables, code blocks, section structures follow existing patterns in CLI reference, settings, workflows catalog
- **Live examples** — YAML and code examples must be valid against the current engine
- **No stale content** — when deprecating or removing features, cut documentation cleanly
- **README updated** — quick-start flow, commands table, and architecture section reflect new docs

## Verification

After each phase:
1. `bun run build` passes (docs are markdown, no build impact, but guard against accidental code changes)
2. Manual review: every link in Getting Started "Next Steps" resolves to an existing file
3. Cross-reference audit: no doc references a deleted or moved file without the updated path
4. README quick-start commands still work (no doc changes should break the CLI)
