# Creating Custom Guidelines

Guidelines inject project-specific coding rules and conventions into agent context.
The engine loads guidelines based on your project's file types, so agents always
follow your team's standards without manual prompt engineering.

## What Guidelines Are

Guidelines are markdown files that describe coding conventions for specific
languages or frameworks. When a workflow runs, the engine scans your project's
files, matches them against guideline glob patterns, and injects the matching
guidelines into every agent's system prompt.

Guidelines live in `~/.hamilton/guidelines/<name>/`:

```
~/.hamilton/guidelines/<name>/
  guideline.yml       # Manifest: name, matching patterns, file list
  convention-1.md     # Guideline content
  convention-2.md
```

## Step 1: Create a Guideline

Create the directory and manifest:

```bash
mkdir -p ~/.hamilton/guidelines/react-ts
```

Create `~/.hamilton/guidelines/react-ts/guideline.yml`:

```yaml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Guideline
metadata:
  name: react-ts
spec:
  instructions:
    - matching: ["**/*.tsx", "**/*.ts"]
      files:
        - component_patterns.md
        - hooks_guide.md
        - testing_conventions.md
```

| Field | Description |
|-------|-------------|
| `matching` | Glob patterns. If any project file matches, the guideline loads. |
| `files` | Relative paths to markdown files in the guideline directory. |

Create `~/.hamilton/guidelines/react-ts/component_patterns.md`:

```markdown
## Component Conventions

- Use functional components with TypeScript interfaces
- Props interfaces must be named `<ComponentName>Props`
- Export as default unless the component is from a barrel export
- Use React.FC only when children are needed
- Keep components under 200 lines; extract sub-components for longer files

## File Organization

- One component per file
- Co-locate styles in <ComponentName>.module.css
- Co-locate tests in <ComponentName>.test.tsx
```

Create `~/.hamilton/guidelines/react-ts/hooks_guide.md`:

```markdown
## Hook Conventions

- Custom hooks start with `use` prefix
- Return an object from hooks, not an array
- Handle loading, error, and success states explicitly
- Use useCallback/useMemo only when profiler shows benefit
- Extract complex hooks into separate files
```

Create `~/.hamilton/guidelines/react-ts/testing_conventions.md`:

```markdown
## Testing Conventions

- Use @testing-library/react for component tests
- Test behavior, not implementation
- Use data-testid only as last resort; prefer role/label queries
- Mock network calls at the fetch/axios level, not the component level
- Each component test covers: rendering, user interaction, error states
```

## Step 2: Register in Settings

Guidelines are auto-discovered from `~/.hamilton/guidelines/`. No settings.yaml
registration is needed — the engine scans the guidelines directory on each run.

## Step 3: Test with a Do Run

```bash
cd /path/to/react-ts-project
hamilton workflow run do "Add a useDebounce hook with tests"
```

The `do` agent will see the react-ts guidelines and apply your conventions
to the generated code.

## Step 4: Iterate

Guideline files are loaded fresh on every run. Edit them and re-run — no
restart or reinstall needed.

Common iteration paths:

1. **Agent ignores a convention** — be more prescriptive: "You MUST..." instead of "Prefer..."
2. **Guidelines are too long** — agents have limited context. Keep each file focused and under 50 lines
3. **Need to exclude some projects** — use more specific glob patterns (e.g., `**/src/**/*.tsx` instead of `**/*.tsx`)
4. **Multiple guideline sets** — create separate guideline directories; the engine loads all matching sets

## Bundled Guidelines

| Guideline | Triggers On |
|-----------|-------------|
| `golang` | `**/*.go`, `go.mod` |

## Guideline Load Order

When multiple guidelines match, the engine loads all of them. Guidelines are
concatenated in alphabetical order by directory name. This is deterministic
but not configurable — design guidelines to be independent and non-overlapping.
