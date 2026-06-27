# Creating Your First Custom Workflow

Build a custom Hamilton workflow from scratch. By the end, you'll have a working
multi-agent pipeline that you can run and iterate on.

## Step 1: Define the Problem

This tutorial builds a "docs-review" workflow that checks documentation files for
clarity, completeness, and consistency.

The workflow has three tasks:
1. Scan the docs/ directory and list all files
2. Review each file for writing quality
3. Generate a summary report with actionable feedback

## Step 2: Design Agent Roles

| Agent | Role | Shared or Workflow-Local |
|-------|------|--------------------------|
| `scanner` | Scans the docs/ directory, lists files, identifies which need review | Workflow-local |
| `reviewer` | Reviews each file for clarity, completeness, consistency | Workflow-local |
| `summarizer` | Compiles findings into a structured report | Workflow-local |

All agents are workflow-local since they're specific to this workflow.

## Step 3: Create Agent Personas

Create the workflow directory:

```bash
mkdir -p ~/.hamilton/workflows/docs-review/agents/{scanner,reviewer,summarizer}
mkdir -p ~/.hamilton/workflows/docs-review/schemas
```

### scanner/agent.yml

```yaml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Agent
metadata:
  name: scanner
spec:
  settings:
    model: default
```

### scanner/INSTRUCTIONS.md

```markdown
# Scanner

## Situation
You are the **scanner** in a documentation review workflow. You have access to the
project's docs/ directory and need to identify which files need review.

## Task
List all documentation files and classify which need review and why.

## Action
1. List all files in the docs/ directory
2. For each file, note: filename, word count (approximate), last modified date
3. Classify: needs review (true/false), priority (high/medium/low)
4. Flag files that are missing, empty, or appear stale

## Progress
Append findings to progress.md with file counts and status.

## Result
{"status": "done", "files": [{"path": "...", "needs_review": true, "priority": "high", "reason": "..."}]}
```

### scanner/SOUL.md

```markdown
# Soul

You are thorough and systematic. You don't skip files just because they're long.
You give each file a fair assessment.

You are impartial: a file's priority depends on its content and role, not its
author or age.
```

### reviewer/agent.yml

```yaml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Agent
metadata:
  name: reviewer
spec:
  settings:
    model: balanced
```

### reviewer/INSTRUCTIONS.md

```markdown
# Reviewer

## Situation
You are the **reviewer** in a documentation review workflow. You receive a list
of files from the scanner and review each one for writing quality.

## Task
Review documentation files for clarity, completeness, and consistency. Provide
actionable feedback for each file.

## Action
1. Read each file in the list
2. Assess: clarity (is the prose understandable?), completeness (are topics covered?),
   consistency (does it follow conventions?)
3. For each issue found, provide: file, line/section, problem, suggestion
4. Rate overall quality: excellent / good / needs_improvement / poor

## Progress
Update progress.md with review status per file.

## Result
{"status": "done", "reviews": [{"file": "...", "rating": "good", "issues": [{"section": "...", "problem": "...", "suggestion": "..."}]}]}
```

### reviewer/SOUL.md

```markdown
# Soul

You are constructive, not critical. You find problems to help improve the
documentation, not to criticize the author. Every issue comes with a clear
suggestion for improvement.
```

### summarizer/agent.yml

```yaml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Agent
metadata:
  name: summarizer
spec:
  settings:
    model: default
```

### summarizer/INSTRUCTIONS.md

```markdown
# Summarizer

## Situation
You are the **summarizer** in a documentation review workflow. You receive
review results and compile them into a structured summary.

## Task
Compile all review findings into a clear, actionable summary report.

## Action
1. Read all reviews
2. Identify common themes and patterns across files
3. Prioritize issues: critical > high > medium > low
4. Produce a markdown summary with: overall assessment, prioritized issues,
   recommended actions, and an estimated effort for each

## Progress
Append summary status to progress.md.

## Result
{"status": "done", "summary": "## Documentation Review Summary\n\n..."}
```

### summarizer/SOUL.md

```markdown
# Soul

You are concise and organized. Your summaries are skimmable but complete.
You highlight what matters most and don't bury the lead.
```

## Step 4: Write the Workflow YAML

Create `~/.hamilton/workflows/docs-review/workflow.yml`:

```yaml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Workflow
metadata:
  name: docs-review
  version: 1
  description: |
    Reviews documentation files for clarity, completeness, and consistency.
    Produces a summary report with actionable feedback.
spec:
  run:
    entrypoint: scanner
    timeout: 300s

  tasks:
    - name: scanner
      dependencies: []
      agent:
        executorRef: scanner
        prompt:
          content: |
            Scan the docs/ directory in the project and list all files.
            For each file, determine if it needs review and assign a priority.
        output:
          schema:
            file: schemas/scanner.json
      on_failure:
        max_retries: 1
        escalate_to: human

    - name: reviewer
      dependencies: [scanner]
      agent:
        executorRef: reviewer
        prompt:
          content: |
            Review each file for clarity, completeness, and consistency.

            Files to review:
            {{inputs.tasks.scanner.outputs.files}}

            Provide actionable feedback for each issue found.
        output:
          schema:
            file: schemas/reviewer.json
      on_failure:
        max_retries: 2
        escalate_to: human

    - name: summarizer
      dependencies: [reviewer]
      agent:
        executorRef: summarizer
        prompt:
          content: |
            Compile the following reviews into a summary report:

            {{inputs.tasks.reviewer.outputs.reviews}}

            Produce a markdown summary organized by priority.
        output:
          schema:
            file: schemas/summarizer.json
      on_failure:
        max_retries: 2
        escalate_to: human
```

## Step 5: Create Output Schemas

### schemas/scanner.json

```json
{
  "type": "object",
  "required": ["status"],
  "properties": {
    "status": { "type": "string", "enum": ["done", "failed", "retry"] },
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["path", "needs_review", "priority"],
        "properties": {
          "path": { "type": "string" },
          "needs_review": { "type": "boolean" },
          "priority": { "type": "string", "enum": ["high", "medium", "low"] },
          "reason": { "type": "string" }
        }
      }
    }
  }
}
```

### schemas/reviewer.json

```json
{
  "type": "object",
  "required": ["status"],
  "properties": {
    "status": { "type": "string", "enum": ["done", "failed", "retry"] },
    "reviews": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["file", "rating"],
        "properties": {
          "file": { "type": "string" },
          "rating": { "type": "string", "enum": ["excellent", "good", "needs_improvement", "poor"] },
          "issues": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "section": { "type": "string" },
                "problem": { "type": "string" },
                "suggestion": { "type": "string" }
              }
            }
          }
        }
      }
    }
  }
}
```

### schemas/summarizer.json

```json
{
  "type": "object",
  "required": ["status"],
  "properties": {
    "status": { "type": "string", "enum": ["done", "failed", "retry"] },
    "summary": { "type": "string" }
  }
}
```

## Step 6: Install

```bash
hamilton workflow install docs-review
```

Verify it appears in the list:

```bash
hamilton workflow list | grep docs-review
```

## Step 7: Run

```bash
cd /path/to/project/with/docs
hamilton workflow run docs-review "Review all documentation files"
```

Monitor progress:

```bash
hamilton workflow logs docs-review-<run-id> -f
```

## Step 8: Add a Variant

Create a `-quick` variant that uses the `fast` model for the scanner and summarizer:

```yaml
# ~/.hamilton/workflows/docs-review/variants/quick.yml
tasks:
  scanner:
    agent:
      model: fast
  summarizer:
    agent:
      model: fast
```

The reviewer still uses `balanced` for quality.

Run with the variant:

```bash
hamilton workflow run docs-review-quick "Review all documentation files"
```

## Step 9: Iterate

After running, inspect the results:

```bash
cat ~/.hamilton/runs/<run-id>/summary.json | jq .
cat ~/.hamilton/runs/<run-id>/task-outputs/<task-id>.json | jq .
```

Common iteration paths:

1. **Agent produces vague output** — tighten the INSTRUCTIONS.md with more specific output format
2. **Task takes too long** — assign a faster model via agent.yml
3. **Schema validation fails** — adjust the JSON schema to match actual agent output
4. **Need another phase** — add a new task with `dependencies: [summarizer]`
5. **Want to reuse an agent** — move it to `~/.hamilton/agents/` for shared use
