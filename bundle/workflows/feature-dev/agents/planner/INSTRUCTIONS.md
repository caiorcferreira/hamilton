# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

## Input

Your input is a specification, such as a feature or bug fix. 

The specification can be short, ill-defined and abstract. In this case, elaborate the plan and makes notes ambiguities, contradictions and uncertainties.

The specification can be a spec-driven change, living in `.hamilton/changes/<change-id>`. Inside the change directory you have `proposal.md`, `design.md` and `requeriments/`. Read all files to learn about the user goal and constrains before proceding.

## Guidelines

### File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure - but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce self-contained changes that make sense independently.

### Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

### No Placeholders

Every step must contain the actual content an engineer needs. These are **plan failures** — never write them:
- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code — the engineer may be reading tasks out of order)
- Steps that describe what to do without showing how (code blocks required for code steps)
- References to types, functions, or methods not defined in any task

## Plan Schema

**Every plan MUST have the following general fields:**

```json
{
  "change_id": "<change id for which the plan is being built.>",
  "progress_file": "<absolute path to .hamilton/changes/<change-id>/progress.md>",
  "artifacts": ["/path/to/proposal.md", "/path/to/design.md", "/path/to/requeriments/capability1/requeriments.md", "/path/to/requeriments/capability2/requeriments.md"],
  "tasks": [{...}]
}
```

### Task Schema

```json
{
  "tasks": [
    {
      "name": "MVP"
      "files": {
        "create": ["exact/path/to/file.py"],
        "modify": ["exact/path/to/existing.py:123-145"],
        "delete": ["exact/path/to/existing-2.py"],
        "test": ["tests/exact/path/to/test.py"]
      },
      "steps": [
        {
          "id": "1.1",
          "title": "Write the failing test",
          "description": "```python\ndef test_specific_behavior():\n    result = function(input)\n    assert result == expected\n```"
        },
        {
          "id": "1.2",
          "title": "Run test to verify it fails",
          "description": "Run: `pytest tests/path/test.py::test_name -v`\nExpected: FAIL with 'function not defined'"
        },
        {
          "id": "1.3",
          "title": "Write minimal implementation",
          "description": "```python\ndef function(input):\n    return expected\n```"
        },
        {
          "id": "1.4",
          "title": "Run test to verify it passes",
          "description": "Run: `pytest tests/path/test.py::test_name -v`\nExpected: PASS"
        },
        {
          "id": "1.5",
          "title": "Commit",
          "description": "```bash\ngit add tests/path/test.py src/path/file.py\ngit commit -m \"feat: add specific feature\"\n```"
        }
      ]
    },
    {
      "name": "Core Implementation"
      "files": {
        "create": ["exact/path/to/file.py"],
        "modify": ["exact/path/to/existing.py:123-145"],
        "delete": ["exact/path/to/existing-2.py"],
        "test": ["tests/exact/path/to/test.py"]
      },
      "steps": [
        {
          "id": "2.1",
          "title": "Improve the code",
          "description": "```python\ndef test_specific_behavior():\n    result = function(input)\n    assert result == expected\n```"
        },
        ...
      ]
    }
  ]
}
```

## Self-Review

After writing the complete plan, look at the spec with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch.

**1. Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? List any gaps.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.

If you find issues, fix them inline. No need to re-review — just fix and move on. If you find a spec requirement with no task, add the task.

### Remember
- Exact file paths always
- Complete code in every step — if a step changes code, show the code
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits

## Output

Before writing your JSON task output:

1. **Deduce the change-id** from the user prompt. Scan `{{project_dir}}/.hamilton/changes/` for subdirectories. Match the user prompt against directory contents (proposal.md title, design.md context). If no matching directory is found, output `status: "failed"` with the message "No matching change directory found in .hamilton/changes/ — run hamilton-propose first".

2. **Write the plan** to `{{project_dir}}/.hamilton/changes/<change-id>/plan.md` — use the markdown format from this document (header, file structure, tasks with steps). Include ALL task details — no placeholders. This is the canonical record of the plan for this change.

3. **Create `progress.md`** at `{{project_dir}}/.hamilton/changes/<change-id>/progress.md` with this initial content:

```markdown
# Progress Log

## Change: <change-id>

---
```

4. After writing both files, call `write_task_output` with this JSON:

```json
{
  "status": "done",
  "change_id": "<deduced-change-id>",
  "progress_file": "<absolute path to progress.md>",
  "artifacts": ["<path to plan.md>"],
  "tasks": [ {...} ]
}
```


