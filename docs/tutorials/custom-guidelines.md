# Creating Custom Guidelines

Guidelines are coding rules and conventions shipped with Kepler and installed to
`${XDG_CONFIG_HOME:-$HOME/.config}/vialactea-works/kepler/guidelines/` by `kepler setup`. Agents and the Assisted skills read these
files directly when working in a project, so they always have your team's standards at hand.

## What Guidelines Are

Guidelines are markdown files that describe coding conventions for specific
languages or frameworks. They live under `${XDG_CONFIG_HOME:-$HOME/.config}/vialactea-works/kepler/guidelines/<name>/`:

```
${XDG_CONFIG_HOME:-$HOME/.config}/vialactea-works/kepler/guidelines/<name>/
  guideline.yml       # Metadata (name, optional glob patterns) — kept for reference
  convention-1.md     # Guideline content
  convention-2.md
```

`kepler setup` copies the bundled guidelines (`general`, `golang`, `typescript`) from
`bundle/guidelines/`. The markdown files are plain text your agent can be pointed at — the
skills and agents read them directly.

## Step 1: Add a Guideline

Add a directory of markdown files under `${XDG_CONFIG_HOME:-$HOME/.config}/vialactea-works/kepler/guidelines/` (or extend the bundled
ones in `bundle/guidelines/` in this repo):

```bash
mkdir -p ${XDG_CONFIG_HOME:-$HOME/.config}/vialactea-works/kepler/guidelines/react-ts
```

Create `${XDG_CONFIG_HOME:-$HOME/.config}/vialactea-works/kepler/guidelines/react-ts/component_patterns.md`:

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

## Step 2: Point Your Agent at It

Mention the guideline file in the project's `AGENTS.md` or in your prompt so the agent loads
it before coding:

```markdown
## Standards

Follow the conventions in ${XDG_CONFIG_HOME:-$HOME/.config}/vialactea-works/kepler/guidelines/react-ts/component_patterns.md
```

## Step 3: Iterate

Guideline files are read on demand. Edit them and re-run — no restart or reinstall needed.

Common iteration paths:

1. **Agent ignores a convention** — be more prescriptive: "You MUST..." instead of "Prefer..."
2. **Guidelines are too long** — agents have limited context. Keep each file focused and under 50 lines
3. **Multiple guideline sets** — create separate guideline directories and point at each as needed

## Bundled Guidelines

| Guideline | Covers |
|-----------|--------|
| `general` | Cross-language coding style |
| `golang` | Go style, setup, testing, patterns, e2e |
| `typescript` | TypeScript setup, style, patterns, unit + e2e testing |
