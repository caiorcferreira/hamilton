# SDD artifact templates

Templates for the seven-stage spec-driven pipeline. Each maps to a well-known standard,
taken in spirit (right-sized), not by conformance.

| Template | Document | Owns | Instance path | Produced or updated by |
|---|---|---|---|---|
| `proposal.md` | PRD | Why | `<change>/proposal.md` | hamilton-propose |
| `requirements-change.md` | SRS (delta) | What | `<change>/requirements/<capability>.md` | hamilton-propose |
| `requirements-spec.md` | SRS (canonical) | What | `.hamilton/specs/<capability>.md` | hamilton-finish-work |
| `design.md` | SDD | How | `<change>/design.md` | hamilton-propose |
| `plan.md` | Plan | Steps | `<change>/plan.md` | hamilton-plan |
| `progress.md` | Task index | Current task status | `<change>/progress.md` | hamilton-plan (initialize) / hamilton-code (update assigned row) |
| `task-progress.md` | Task Progress | Task execution history | `<change>/tasks/task-N/progress.md` | hamilton-plan (initialize) / hamilton-code (append attempts) |
| `feedback.md` | Code Feedback | Task feedback | `<change>/tasks/task-N/feedback.md` | hamilton-code-feedback |
| `review.md` | Whole-branch Review | Whole-branch verdict | `<change>/review.md` | hamilton-review |
| `finish.md` | Finish History | Finish attempts and outcomes | `<change>/finish.md` | hamilton-finish-work |

The two SRS forms are the same content in two states: `requirements-change.md` is the
delta a change proposes; `requirements-spec.md` is the consolidated truth it folds into.

## Required vs optional

`plan.md` is the only required declarative input to execution. `proposal.md`, `design.md`, and
`requirements/` are optional: small or mechanical changes may start directly at hamilton-plan.

Hamilton-plan also creates the required operational scaffold: root `progress.md` and one linked
`tasks/task-N/progress.md` file for every active task. Later stages consume that plan and operational
state; only planning works directly from a raw request when richer upstream artifacts are absent.

## Wayfinder templates

These templates support wayfinding—the optional pre-change stage that clarifies a change's
shape before committing to the SDD loop. They are not SDD pipeline artifacts.

| Template | Artifact | Produced by |
|---|---|---|
| `wayfinder/map.md` | Map | hamilton-wayfinder |
| `wayfinder/ticket.md` | Decision ticket | hamilton-wayfinder |
| `wayfinder/route.md` | Route | hamilton-wayfinder |

The artifacts these templates produce live under `.hamilton/maps/<effort>/`: `map.md` and
`route.md` at the root, and decision tickets at `tickets/NN-slug.md`. Unlike `specs/` and
`changes/`, the `.hamilton/maps/` directory is not scaffolded by `hamilton-init`; the
wayfinder skill creates it on first use.

## Where these templates live

These templates are global, not per-project. They are bundled here in `bundle/templates/`
and copied to `~/.hamilton/templates/` by the `hamilton setup` command. The pipeline steps
read the installed copy at `~/.hamilton/templates/<name>.md`.

## Where the artifacts they produce live

Per-project, under the project's `.hamilton/` directory (created by `hamilton-init`):

```
.hamilton/
  specs/
    <capability>.md
  changes/
    <YYYY-MM-DD-change-title>/
      proposal.md
      design.md
      requirements/
        <capability>.md
      plan.md
      progress.md
      tasks/
        task-N/
          progress.md
          feedback.md
      review.md
      finish.md
```

`plan.md` is the declarative task contract authored up front. Hamilton-plan initializes the root
`progress.md` current-task ledger and each linked task progress file from the installed templates.
Hamilton-code updates only its assigned root row and appends implementation attempts to that task's
progress file. Task feedback is kept alongside task progress, while `review.md` and `finish.md`
remain change-level artifacts.

`requirements/*.md` inside a change use delta headers (ADDED / MODIFIED / REMOVED /
RENAMED). `hamilton-finish-work` folds those deltas into the canonical
`.hamilton/specs/<capability>.md`, which holds no delta markers.
