# Authoring Custom Workflows

Create your own multi-agent workflows beyond the bundled set.

## Directory Structure

Create a new workflow under `~/.hamilton/workflows/<slug>/`:

```
~/.hamilton/workflows/my-workflow/
  workflow.yml         # Workflow spec
  schemas/             # Output schemas (JSON)
    task-a.json
    task-b.json
  agents/              # Workflow-local agents (optional)
    custom-agent/
      agent.yml
      INSTRUCTIONS.md
      SOUL.md
  prompts/             # External prompt files (optional)
    my-prompt.md
```

## Workflow Boilerplate

```yaml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Workflow
metadata:
  name: my-workflow
  version: 1
  description: |
    What this workflow does, in detail.
spec:
  run:
    entrypoint: first-task
    timeout: 300s

  tasks:
    - name: first-task
      dependencies: []
      agent:
        executorRef: my-agent
        prompt:
          content: |
            Do the first thing: {{task}}
        output:
          schema:
            file: schemas/first-task.json
      on_failure:
        max_retries: 3
        escalate_to: human

    - name: second-task
      dependencies: [first-task]
      agent:
        executorRef: another-agent
        prompt:
          content: |
            Do the second thing.
            CONTEXT: {{inputs.tasks.first-task.outputs.some_field}}
```

## Defining Output Schemas

Create `schemas/<task-name>.json`:

```json
{
  "type": "object",
  "required": ["status"],
  "properties": {
    "status": { "type": "string", "enum": ["done", "failed", "retry"] },
    "result": { "type": "string" },
    "files_changed": {
      "type": "array",
      "items": { "type": "string" }
    }
  }
}
```

Always include `status` as a required field. The engine uses `status` to determine
task completion. `retry` triggers a retry with the output as feedback.

## Script Task Workflows

For deterministic CI/CD-like pipelines without AI agents:

```yaml
tasks:
  - name: install
    dependencies: []
    script:
      command: npm ci
    output:
      schema:
        file: schemas/script-output.json
    on_failure:
      max_retries: 2

  - name: typecheck
    dependencies: [install]
    script:
      command: npm run typecheck
    output:
      schema:
        file: schemas/script-output.json

  - name: build
    dependencies: [typecheck]
    script:
      command: npm run build

  - name: test
    dependencies: [build]
    script:
      command: npm test
    on_failure:
      max_retries: 3
```

Script tasks use no tokens, making them suitable for build pipelines. Output is
captured from stdout/stderr up to `script.maxOutputBytes` (64KB default).

## Installing Custom Workflows

Manually copy to `~/.hamilton/workflows/<slug>/` or use:

```bash
hamilton workflow install my-workflow
```

For development, work directly in `~/.hamilton/workflows/`. Hamilton reads
workflow YAMLs from disk on every run -- no compilation step needed.

## Validation Tips

Common mistakes when authoring workflows:

1. **Missing output schemas**: Tasks without schemas can't validate agent output.
   Always define at least `{ "required": ["status"] }`.
2. **Wrong executorRef**: Must match `metadata.name` in `agent.yml`.
3. **Circular dependencies**: `A depends on B, B depends on A` is caught at load
   time with `"circular dependency detected"`.
4. **Template variable typos**: `{{inputs.tasks.triage.outputs.severty}}` (missing 'i')
   won't resolve. Test with `--foreground` to see unresolved variables in the prompt.
5. **Non-array forEach ref**: `valueFrom.ref` must resolve to an array. Non-array
   values cause a runtime error.
