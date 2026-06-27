# Template Expansion

How template variables and the forEach loop construct work in workflow YAML.

## Template Variables

Template variables use `{{...}}` syntax. The engine renders them via
[Handlebars](https://handlebarsjs.com/) before sending prompts to agents.

### Where Variables Come From

| Source | Syntax | Example |
|--------|--------|---------|
| Workflow input | `{{task}}` | `{{task}}` resolves to the prompt string passed on the CLI |
| Upstream task output | `{{inputs.tasks.<name>.outputs.<field>}}` | `{{inputs.tasks.triage.outputs.severity}}` |
| Workflow metadata | `{{inputs.run_id}}` | `{{inputs.run_id}}` resolves to the current run ID |

### Context Propagation

When a task named `scanner` produces:

```json
{"status": "done", "files": [{"path": "readme.md", "needs_review": true}]}
```

Downstream tasks can access:

```yaml
- name: reviewer
  dependencies: [scanner]
  agent:
    prompt:
      content: |
        Files to review: {{inputs.tasks.scanner.outputs.files}}
```

Only tasks declared in `dependencies` have their outputs available. This enforces
the DAG ordering and prevents accidental access to incomplete outputs.

## forEach Loops

The `forEach` construct iterates a task over a list, executing one instance per
element.

### Basic forEach

```yaml
- name: review-files
  dependencies: [scanner]
  forEach:
    valueFrom:
      ref: scanner
      path: outputs.files
    template:
      agent:
        executorRef: reviewer
        prompt:
          content: |
            Review this file: {{item.path}}
            Priority: {{item.priority}}
```

When `scanner.outputs.files` is a 5-element array, `review-files` executes 5 times —
once per file. The current item is available as `{{item}}`.

### Template Syntax Within forEach

Within a `forEach` template, the current iteration element is `{{item}}`. Upstream
outputs are still available via `{{inputs.tasks.<name>.outputs.<field>}}`.

The `{{item}}` variable is a single element from the referenced array. If the array
contains objects, access fields with dot notation: `{{item.path}}`.

### Context Propagation in Loops

Each forEach iteration produces its own output. The iteration index and output
are available to downstream tasks:

```
review-files
  ├── review-files[0] → { "status": "done", "file": "readme.md", "rating": "good" }
  ├── review-files[1] → { "status": "done", "file": "api.md", "rating": "needs_improvement" }
  └── ...
```

A downstream task can reference all iteration outputs:

```yaml
- name: summarizer
  dependencies: [review-files]
  agent:
    prompt:
      content: |
        Summary of reviews:
        {{inputs.tasks.review-files.outputs}}
```

The `outputs` field for a forEach task is an array of all iteration results.

## Common Pitfalls

### Wrong field path in forEach ref

```yaml
forEach:
  valueFrom:
    ref: scanner
    path: outputs.files  # correct: creates array of 5 items

forEach:
  valueFrom:
    ref: scanner
    path: outputs        # wrong: iterates over the entire output object
```

The `path` must resolve to an array. Non-array values cause a runtime error.

### Unresolved variables

```yaml
prompt:
  content: |
    Severity: {{inputs.tasks.triage.outputs.severty}}
```

A typo (`severty` instead of `severity`) means the variable won't resolve. Test with
`-foreground` mode to see unresolved variables in the rendered prompt.

### Missing dependency

```yaml
- name: reviewer
  dependencies: []          # ← missing 'scanner'
  agent:
    prompt:
      content: |
        {{inputs.tasks.scanner.outputs.files}}  # ← won't resolve
```

Variables from a task are only available if that task is in `dependencies`.

## Nested Template Resolution

Templates are resolved depth-first. If a template variable resolves to a string
that contains template syntax, the engine resolves it again:

```yaml
# Task A output: { "prompt": "Review: {{code}}" }

# Task B prompt:
Review output:
{{inputs.tasks.A.outputs.prompt}}
```

After first pass: `Review: {{code}}` — the engine resolves `{{code}}` from the
current task's context if available. This is rare but can happen with prompt
templates that reference variables from the same task's input.
