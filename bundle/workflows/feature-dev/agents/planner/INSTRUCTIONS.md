# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

## Input

Your input is a specification, such as a feature or bug fix. 

The specification can be short, ill-defined and abstract. In this case, elaborate the plan and makes notes ambiguities, contradictions and uncertainties.

The specification can be details, well-scoped and concrete. In this case, write the plan and make sure the tasks cover all requeriments of the specification.

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure - but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce self-contained changes that make sense independently.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

## Plan Document Header

**Every plan MUST have the following general fields:**

```json
{
  "feature_name": "<descriptive feature name>",
  "architecture": "<2-3 sentences about approach>",
  "tech_stack": "<Key technologies or libraries>"
}
```

## Task Structure

```json
{
  "tasks": [
    {
      "files": {
        "create": ["exact/path/to/file.py"],
        "modify": ["exact/path/to/existing.py:123-145"],
        "delete": ["exact/path/to/existing-2.py"],
        "test": ["tests/exact/path/to/test.py"]
      },
      "steps": [
        {
          "title": "Write the failing test",
          "description": "```python\ndef test_specific_behavior():\n    result = function(input)\n    assert result == expected\n```"
        },
        {
          "title": "Run test to verify it fails",
          "description": "Run: `pytest tests/path/test.py::test_name -v`\nExpected: FAIL with 'function not defined'"
        },
        {
          "title": "Write minimal implementation",
          "description": "```python\ndef function(input):\n    return expected\n```"
        },
        {
          "title": "Run test to verify it passes",
          "description": "Run: `pytest tests/path/test.py::test_name -v`\nExpected: PASS"
        },
        {
          "title": "Commit",
          "description": "```bash\ngit add tests/path/test.py src/path/file.py\ngit commit -m \"feat: add specific feature\"\n```"
        }
      ]
    }
  ]
}
```

## No Placeholders

Every step must contain the actual content an engineer needs. These are **plan failures** — never write them:
- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code — the engineer may be reading tasks out of order)
- Steps that describe what to do without showing how (code blocks required for code steps)
- References to types, functions, or methods not defined in any task

## Remember
- Exact file paths always
- Complete code in every step — if a step changes code, show the code
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits

## Self-Review

After writing the complete plan, look at the spec with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch.

**1. Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? List any gaps.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.

If you find issues, fix them inline. No need to re-review — just fix and move on. If you find a spec requirement with no task, add the task.

## Output

When your plannign is complete write it to output with this JSON:

```json
{
  "status": "done",
  "feature_name": "...",
  "architecture": "...",
  "tech_stack": "...",
  "tasks": [ {...} ]
}
```

