# Variants

Variants modify a base workflow's behavior by changing tasks, model assignments, or
output destinations. A variant is a suffix appended to the workflow slug.

## How Variants Work

When you run a workflow with a variant, the engine loads the base workflow YAML and
applies the variant's overrides. Variants can:

- **Add tasks** — `-github-pr` appends a PR creation task
- **Remove tasks** — `-no-fix` skips implementation, useful for triage-only runs
- **Change model** — `-fast` assigns faster/cheaper models to all tasks
- **Enable modes** — `-foreground` runs in foreground mode with live output

The engine loads `workflow.yml` for the base workflow, then applies variant
patches from the variant definition.

## Available Variants

All workflows support a common set of CLI/mode variants:

| Suffix | Effect |
|--------|--------|
| `-foreground` | Run in foreground mode with live streaming output |
| `-foreground-stream-json` | Foreground mode with JSON-formatted event stream |

Workflow-specific variants:

| Workflow | Variant | What it does |
|----------|---------|--------------|
| `bug-fix` | `-github-pr` | Appends a PR creation task using the `pr` agent |
| `bug-fix` | `-no-fix` | Triage and investigate only, skip `fix` and `verify` tasks |
| `feature-dev` | `-github-pr` | Appends a PR creation task |
| `security-audit` | `-github-pr` | Appends a PR with the audit report |
| `quarantine-broken-tests` | `-github-pr` | Appends a PR with the quarantine changes |
| `scaffold` | `-github-pr` | Appends a PR with the scaffolded project |

## Using Variants

```bash
hamilton workflow run bug-fix-github-pr "Fix the login crash on empty email"
```

The variant suffix is appended directly to the workflow slug. The engine splits
on the first `-`, loads the base workflow, and applies the variant.

## Composition

Variants are additive. You can't combine multiple variants (e.g., `-github-pr-no-fix`
is not supported). Choose one variant per run.

For mode variants like `-foreground`, combine with the base workflow name:

```bash
hamilton workflow run bug-fix-foreground "Fix the crash"
```

## When to Use Each Variant

- **`-github-pr`**: When you want Hamilton to open a PR with the results. Use for
  workflows where the output should persist in version control.
- **`-no-fix`**: When you only want analysis, not implementation. Useful for
  understanding a bug before deciding whether to fix it.
- **`-foreground`**: During development or debugging. See live agent output as it
  happens instead of waiting for the complete run.
