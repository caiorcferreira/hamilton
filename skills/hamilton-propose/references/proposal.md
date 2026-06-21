# Proposal document

Create the proposal document that establishes WHY this change is needed.This is the foundation - requeriments, design, and tasks all build on this.

## Process
- Check out the current project state first (files, docs, recent commits)
- Before asking detailed questions, assess scope: if the request describes multiple independent subsystems (e.g., "build a platform with chat, file storage, billing, and analytics"), flag this immediately. Don't spend questions refining details of a project that needs to be decomposed first.
- If the project is too large for a single spec, stop and instruct the user to decompose it first.
- For appropriately-scoped projects, ask clarifying questions one at a time to refine the idea
- Prefer multiple choice questions when possible, but open-ended is fine too
- Only one question per message - if a topic needs more exploration, break it into multiple questions
- Focus on understanding: purpose, constraints, success criteria

## Format
- **Why**: 1-2 sentences on the problem or opportunity. What problem does this solve? Why now?
- **What Changes**: Bullet list of changes. Be specific about new capabilities, modifications, or removals. Mark breaking changes with **BREAKING**.
- **Capabilities**: Identify which requeriments will be created or modified:
  - **New Capabilities**: List capabilities being introduced. Each becomes a new `requeriments/<name>/requeriments.md`. Use kebab-case names (e.g., `user-auth`, `data-export`).
  - **Modified Capabilities**: List existing capabilities whose REQUIREMENTS are changing. Only include if requeriments-level behavior changes (not just implementation details). Each needs a delta requeriments file. Check `openspec/requeriments/` for existing capabilities names. Leave empty if no requirement changes.
- **Impact**: Affected code, APIs, dependencies, or systems.

Use the template below fo generate the file:

### Template
```markdown
## Why

<!-- Explain the motivation for this change. What problem does this solve? Why now? -->

## What Changes

<!-- Describe what will change. Be specific about new capabilities, modifications, or removals. -->

## Capabilities

### New Capabilities
<!-- Capabilities being introduced. Replace <name> with kebab-case identifier (e.g., user-auth, data-export, api-rate-limiting). Each creates specs/<name>/spec.md -->
- `<name>`: <brief description of what this capability covers>

### Modified Capabilities
<!-- Existing capabilities whose REQUIREMENTS are changing (not just implementation).
     Only list here if spec-level behavior changes. Each needs a delta spec file.
     Use existing spec names from openspec/specs/. Leave empty if no requirement changes. -->
- `<existing-name>`: <what requirement is changing>

## Impact

<!-- Affected code, APIs, dependencies, systems -->
```


## Guardrails
- IMPORTANT: The Capabilities section is critical. It creates the contract between
proposal and requeriments phases. Research existing capabilities before filling this in.
Each capability listed here will need a corresponding requeriments file.
- Keep it concise (1-2 pages). Focus on the "why" not the "how" -
implementation details belong in design.md.