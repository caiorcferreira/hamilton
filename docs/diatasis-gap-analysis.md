# Hamilton Documentation — Diátaxis Gap Analysis Report

## 1. Executive Summary

Hamilton's documentation set (11 files: 1 README + 10 docs/) is reference-heavy and technically thorough but architecturally imbalanced. The **Reference** quadrant dominates with 5 dedicated documents (CLI, Settings, Workflow YAML, Workflows Catalog, LSP Autocheck) — all well-structured and complete. The **Tutorial** and **Explanation** quadrants each have one strong entry (Getting Started, Philosophy), but nothing beyond them. The **How-to** quadrant has Use Cases (solid) and a kitchen-sink Advanced document that conflates How-to, Reference, and Explanation content into one 600-line file. There is no troubleshooting guide, no custom-workflow tutorial, and no dedicated explanation of the variant composition system. The documentation lacks a clear entry-to-mastery path beyond Getting Started → pick-any-reference-page.

---

## 2. Documentation Inventory

| Document | Diátaxis Category | Completeness | Notes |
|----------|-------------------|-------------|-------|
| `README.md` | **Mixed: How-to + Reference** | Partial | Serves as landing page. Duplicates content from docs/ (commands table, workflow catalog, YAML example). Good quick-start but not a substitute for Getting Started. |
| `docs/philosophy.md` | **Explanation** | High | Excellent — clear design rationale, principles, execution model. Stands alone well but is linked nowhere from Getting Started or other pages. Users may never find it. |
| `docs/getting-started.md` | **Tutorial** | High | Strong step-by-step: install → init → verify → list → run → monitor → pause/resume. Includes "Next Steps" links. Ends at a single basic `bug-fix` run — no variant usage, no custom workflow, no `feature-dev` walkthrough. |
| `docs/advanced.md` | **Mixed: How-to + Reference + Explanation** | Medium | Kitchen-sink document. Covers custom workflows, model aliases, guidelines, telemetry, MCP, LSP autocheck, extensions, working dirs, Effect-TS, state machine, performance, operations. Model alias section repeats settings.md content. |
| `docs/agents.md` | **Mixed: Reference + How-to** | High | Well-structured reference for agent manifests, persona files, two-tier resolution, prompt building. The "Authoring Custom Agents" section is a how-to embedded within reference. Includes a "Documentation Conventions" section (contributor-facing, not user-facing). |
| `docs/cli-reference.md` | **Reference** | High | Complete command-by-command reference with flags, arguments, examples, output samples. Well-organized with symbol legends and variant tables. |
| `docs/use-cases.md` | **How-to Guide** | High | Task-oriented problem/solution pairs for 7 use cases. Each follows a good pattern: command → pipeline → what happens → typical duration/output. The "Combining Workflows" section is particularly useful. |
| `docs/settings.md` | **Reference** | High | Exhaustive reference for every settings.yaml key with types, defaults, examples, and error handling behavior. Bootstrap and leniency sections are well-done. |
| `docs/workflows-catalog.md` | **Reference** | High | Complete catalog of all 7 bundled workflows with DAG diagrams, task details, context flow, variant suffixes. Good per-workflow documentation. |
| `docs/workflow-yaml.md` | **Reference** | High | Exhaustive YAML schema reference. Covers envelope, RunConfig, Variants, all task types, template variables, context flow, on-failure, CEL conditions, DAG algorithm, validation. Complete example at the end. |
| `docs/features/lsp-autocheck.md` | **Mixed: Explanation + Reference** | Medium | Explains mechanism and design decisions well, but includes TypeScript code snippets and extension pipeline config that push it toward reference. Not linked from Getting Started or Settings — discoverability is low. |

### Classification Notes

- **`README.md`**: Starts as a How-to (quick start, installation), shifts to Reference (commands table, workflow catalog, YAML format). Functions as a landing page but duplicates substantial content from docs/ pages.
- **`docs/advanced.md`**: Resists classification. Sections like "Authoring Custom Workflows" (How-to), "Performance Characteristics" (Reference), "State Machine Reference" (Reference), and "Effect-TS Integration" (Explanation) are jumbled together. The document name "Advanced Topics" signals to the reader that it's a catch-all, which undermines findability.
- **`docs/agents.md`**: The last section "Documentation Conventions for Hamilton Development" (lines 437–464) is contributor-facing documentation for Hamilton developers, not end users. It belongs in CONTRIBUTING.md or AGENTS.md, not in user-facing docs.

---

## 3. Knowledge Progression Map

### Current reading path (as designed by Getting Started "Next Steps" links)

```
README.md
    │
    ▼
Getting Started ──────────────────────────────────────────────┐
    │                                                          │
    ├──► Workflow YAML Reference  ──► (understanding specs)    │
    ├──► CLI Reference             ──► (command mastery)       │
    ├──► Agent System              ──► (creating agents)       │
    ├──► Workflows Catalog         ──► (what's available)      │
    ├──► Use Cases                 ──► (applied patterns)      │
    └──► Settings Reference        ──► (configuration)         │
                                                               │
Advanced.md (linked from Agent docs, but not from Getting Started)
    │
    ├── Custom Workflows (assumes YAML knowledge)
    ├── Model Aliases (duplicates settings.md)
    ├── Guidelines
    ├── Telemetry
    ├── MCP
    ├── LSP Autocheck (also has /features/lsp-autocheck.md)
    ├── Extensions
    ├── State Machine
    └── Operations

Philosophy.md (linked from Agent docs' code-to-doc table, nowhere else)

LSP Autocheck (standalone, not linked from Getting Started)
```

### Breaks and leaps

1. **Getting Started → Workflow YAML is too large a leap.** After a single `bug-fix` run, the user is pointed at the 760-line YAML reference. A user who just learned to run a workflow does not need to author one yet. There's no intermediate "understand what you just ran" page.

2. **Philosophy is undiscoverable.** It's linked from `agents.md` (the code-to-documentation mapping table, a contributor section), not from Getting Started. A new user has no path to it.

3. **Advanced.md has no prerequisites stated.** It assumes knowledge of YAML authoring, model aliases, and the extension pipeline without linking to those pages.

4. **LSP Autocheck is isolated.** Mentioned in Getting Started as `hamilton doctor` output and in advanced.md, but the dedicated page at `features/lsp-autocheck.md` is linked from nowhere.

5. **Variant system lacks a concept page.** Variants are referenced in CLI reference, workflow catalog, YAML reference, and use cases, but there's no single page that explains what variants are conceptually, how they compose, and why you'd use one over another.

6. **No "what went wrong" path.** Every document assumes success. If `hamilton init` fails, `hamilton workflow run` errors, or an agent produces bad output — there's no troubleshooting page to consult.

---

## 4. Gap Catalog

| # | Feature/Topic | Missing Doc Type | Priority | Proposed Document | Prerequisites | Fits After |
|---|--------------|-----------------|----------|-------------------|---------------|------------|
| 1 | Troubleshooting common failures | **How-to Guide** | Critical | `docs/troubleshooting.md` | Getting Started | Getting Started |
| 2 | Understanding a workflow run (what just happened?) | **Explanation** | Critical | `docs/how-workflows-run.md` | Getting Started | Getting Started, before Workflow YAML |
| 3 | Creating your first custom workflow | **Tutorial** | Critical | `docs/tutorials/custom-workflow.md` | Getting Started, basic YAML familiarity | Getting Started |
| 4 | Variant system explained | **Explanation** | High | `docs/variants.md` | Getting Started, basic workflow concepts | Getting Started or Use Cases |
| 5 | Debugging a failed run | **How-to Guide** | High | `docs/debugging-runs.md` (expand advanced.md section) | Use Cases, basic CLI knowledge | Use Cases |
| 6 | Creating custom guidelines | **Tutorial** | High | `docs/tutorials/custom-guidelines.md` | Agent System basics | Agents or Advanced |
| 7 | `advanced.md` decomposition | **Structural** | High | Split into: `docs/custom-workflows.md` (How-to), `docs/telemetry.md` (Reference), `docs/mcp.md` (Reference), `docs/operations.md` (How-to) | N/A | N/A |
| 8 | Model aliases deep dive | **Explanation** | Medium | `docs/model-aliases.md` (or fold into settings) | Settings | Settings |
| 9 | Using the `do` workflow effectively | **How-to Guide** | Medium | Expand `docs/use-cases.md` §General-Purpose Tasks | Getting Started | Use Cases |
| 10 | forEach/template system explained | **Explanation** | Medium | `docs/template-expansion.md` | Workflow YAML basics | Workflow YAML |
| 11 | CI/CD integration patterns | **How-to Guide** | Medium | `docs/ci-cd-integration.md` | Use Cases, CLI Reference | Use Cases |
| 12 | Philosophy discoverability | **Structural** | Medium | Add link from Getting Started "Next Steps" | None | Getting Started |
| 13 | LSP autocheck discoverability | **Structural** | Medium | Link from Getting Started (LSP server table), Settings (LSP section) | None | Getting Started, Settings |
| 14 | Contributor docs in agents.md | **Structural** | Medium | Extract "Documentation Conventions" section from `agents.md` into CONTRIBUTING.md or an internal doc | None | N/A |

---

## 5. Structural Assessment

### Coverage by Diátaxis quadrant

| Quadrant | Pages | % of doc set | Health |
|----------|-------|-------------|--------|
| **Tutorial** | 1 (Getting Started) | 9% | Underweight. One tutorial is not enough for a product with 7 workflow types, custom workflow authoring, and a guidelines system. |
| **How-to Guide** | 1.5 (Use Cases + half of Advanced.md) | 12% | Underweight. Advanced.md's how-to sections (custom workflows, guidelines) are mixed with reference/explanation, degrading findability. |
| **Reference** | 5 (CLI, Settings, Workflow YAML, Workflows Catalog, half of Agents.md) | 50% | Healthy. Each reference doc is thorough and well-structured. The reference quadrant is Hamilton's documentation strength. |
| **Explanation** | 1 (Philosophy) + fragments in Advanced.md, LSP Autocheck | 9% | Underweight. Philosophy is excellent but buried. Multiple concepts lack explanation: variants, forEach, state machine. |
| **Mixed/Ambiguous** | 3 (README, Agents, LSP Autocheck) + Advanced.md | 20% | Problematic. Advanced.md is the worst offender — a 600-line file spanning 3 quadrants. Mixed documents hide content from users who browse by task rather than by filename. |

### Commentary on imbalance

**The documentation is inverted relative to user needs.** A new user needs Tutorials and How-to Guides most, yet these are the two most underrepresented quadrants. A Hamilton expert needs Reference most, and indeed Reference is the strongest quadrant. The documentation is built for experts who already understand Hamilton conceptually, not for newcomers learning the system.

**Advanced.md is a structural anti-pattern.** It signals to the reader "everything else goes here." Its 12 sections span custom workflows, config, monitoring, architecture, and operations — each could be a standalone page. Users looking for "how to debug a run" or "how to set up telemetry" have no direct entry point; they must scan a 600-line document.

---

## 6. Action Plan

### Top 3 documents to write first

**1. `docs/troubleshooting.md` (Critical — How-to Guide)**
*Why*: Without it, every failure is a dead end. Currently no page answers "what do I do when `hamilton init` says 'rtk not found'?" or "my workflow is stuck in 'running' forever." This is the single highest-impact gap because it affects every user's first failure.
*Estimated effort*: Medium (collect common failure modes from source code and issues, write problem/solution pairs).

**2. `docs/how-workflows-run.md` (Critical — Explanation)**
*Why*: Bridges the chasm between "I ran one command" (Getting Started) and "here's the full YAML spec" (Workflow YAML Reference). Explains what actually happens during a run: DAG construction, agent resolution, context flow, state transitions — without the YAML schema detail. Gives users a mental model before they encounter the reference.
*Estimated effort*: Small (mostly extract and rewrite content already in Philosophy + Advanced sections).

**3. `docs/tutorials/custom-workflow.md` (Critical — Tutorial)**
*Why*: The most important user activity after initial setup — creating their own workflow — has zero tutorial coverage. Agent System shows how to author an agent, but there's no step-by-step walkthrough that takes a user from "I have an idea for a workflow" to "it runs in Hamilton." Without this, the product's main extensibility path is undocumented.
*Estimated effort*: Large (requires a complete end-to-end walkthrough: define problem → create agent personas → write YAML → define schemas → install → run → iterate).

### Remaining gaps by priority and effort

| # | Gap | Priority | Effort |
|---|-----|----------|--------|
| 4 | Variants concept page | High | Small (synthesize from existing variant text across 4 docs) |
| 5 | Debugging runs how-to | High | Small (expand advanced.md section) |
| 6 | Custom guidelines tutorial | High | Medium |
| 7 | Split advanced.md into 4+ standalone docs | High | Medium |
| 8 | Model aliases deep dive | Medium | Small (extract from advanced.md + settings.md) |
| 9 | Expand `do` workflow in use-cases | Medium | Small |
| 10 | forEach/template explanation | Medium | Medium |
| 11 | CI/CD integration | Medium | Medium |
| 12–14 | Link fixes (philosophy, LSP, contributor docs) | Medium | Trivial (edit 3 files to add cross-links) |

### Estimated total effort

- **Trivial** (link fixes): ~30 minutes
- **Small** (4 items): ~2–3 hours each
- **Medium** (5 items): ~1 day each
- **Large** (1 item — custom workflow tutorial): ~2–3 days

**Total**: approximately 8–10 working days to close all identified gaps.
