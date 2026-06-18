# Full-Fledged Templating with Conditionals and Loops

**Date:** 2026-06-18
**Status:** approved

## Problem

The current template system is a 23-line regex-based `{{dotted.path}}` resolver in `src/prompts/template.ts`. It supports only variable substitution — no conditionals, no loops, no filters. Templates are entirely inline in workflow YAML `content:` fields. The ROADMAP explicitly lists "Add full fledge templating" as an unchecked item.

## Solution

Replace the regex resolver with **Handlebars**, configured for backward compatibility. Add conditionals (`{{#if}}`) and loops (`{{#each}}`). Support `.hbs` and `.md` file references alongside inline `content:`. Wire a `strict` flag through `~/.hamilton/settings.yaml` so users can opt into strict missing-variable enforcement.

## Design

### 1. Template Engine — Handlebars

Handlebars was chosen because:
- Logic-less by design: no arbitrary expressions, no code execution, no prototype access. Eliminates SSTI and code injection.
- `{{...}}` delimiters match the existing syntax, minimizing migration friction.
- Battle-tested, widely audited in production JS ecosystems.
- `noEscape: true` makes `{{var}}` output raw strings (not HTML-escaped), matching current behavior.

Only conditionals and loops are exposed — no partials, no custom helpers, no includes. The feature set is:

| Feature | Syntax |
|---------|--------|
| Variable substitution | `{{name}}`, `{{inputs.tasks.x.outputs.y}}` |
| Conditionals | `{{#if condition}}...{{else}}...{{/if}}` |
| Negation | `{{#unless condition}}...{{/unless}}` |
| Loops over arrays | `{{#each items}}...{{/each}}` |
| Loop context | `@index`, `@first`, `@last`, `this` |

### 2. Settings — strict vs. lenient

New section in `~/.hamilton/settings.yaml`:

```yaml
templating:
  strict: false   # false = silently pass through missing variables (backward compat)
                  # true  = throw MissingVariableError, task fails before agent invocation
```

When `strict: false`, Handlebars is configured with a custom `missingVariable` handler that returns the original placeholder text (e.g. `{{unknown}}`). This preserves the current regex resolver's behavior where unresolved placeholders pass through as literal text.

When `strict: true`, a `MissingVariableError` is thrown at render time. The task fails immediately — the agent is never called.

### 3. Parameter Flow — no global state

The `strict` flag is read once from `settings.yaml` at CLI startup and passed explicitly through every call site via an options object:

```ts
export interface TemplateOptions {
  strict: boolean
}
```

Call chain:

```
settings.yaml
  → run.ts (reads templating.strict)
    → runWorkflow(spec, env, options)
      → buildAgentPrompt(params, options)
        → resolveTemplate(content, context, options)
        → resolveFileTemplate(filePath, context, options)
```

### 4. API Changes

**`src/prompts/template.ts`** — rewritten:

```ts
export interface TemplateOptions {
  strict: boolean
}

export function resolveTemplate(
  template: string,
  context: Record<string, unknown>,
  options: TemplateOptions
): string

export function resolveFileTemplate(
  filePath: string,
  context: Record<string, unknown>,
  options: TemplateOptions
): Effect<string, TemplateError>
```

**`src/prompts/builder.ts`** — signature change:

```ts
buildAgentPrompt(params: PromptParams, options: TemplateOptions): string
```

The builder passes the full `WorkflowEnv` directly to Handlebars instead of wrapping it in `{ inputs: env }`. Existing templates referencing `{{inputs.tasks.x.outputs.y}}` continue to work because `inputs` is already a top-level key in `WorkflowEnv`.

### 5. File Templates

Task prompts can reference template files as an alternative to inline `content:`:

```yaml
agent:
  prompt:
    file: templates/implement.hbs     # explicit Handlebars template
    # or
    file: prompts/implement-story.md  # markdown with embedded Handlebars
```

Files are resolved from `~/.hamilton/workflows/<name>/`, matching the existing resolution pattern for `prompt.file` and `schema.file` in `resolveWorkflowSpec`. Both `.hbs` and `.md` extensions are accepted — `.md` files often already contain `{{...}}` placeholders and benefit from Handlebars processing. Files with other extensions or no extension are read as raw text without Handlebars processing (existing behavior for `prompt.file`).

### 6. Error Handling

`TemplateError` is the union of all template failures:

```ts
export type TemplateError = MissingVariableError | TemplateSyntaxError | TemplateFileError
```

Three error types, all `Data.TaggedError`:

| Error | When |
|-------|------|
| `MissingVariableError` | `strict: true` and a `{{variable}}` has no match in context |
| `TemplateSyntaxError` | Malformed Handlebars (unclosed blocks, mismatched tags) |
| `TemplateFileError` | File template not found, unreadable, or extension not `.hbs`/`.md` |

All bubble through the existing `Effect` chain. Template rendering errors fail the task before the agent is invoked.

### 7. Files Affected

| File | Change |
|------|--------|
| `src/prompts/template.ts` | Rewritten — Handlebars instance, `resolveTemplate`, `resolveFileTemplate` |
| `src/prompts/builder.ts` | Signature change — accepts `TemplateOptions` |
| `src/workflow/loader.ts` | `resolveWorkflowSpec` — handle `.hbs`/`.md` file templates |
| `src/workflow/runner.ts` | Pass `strict` from settings through to builder |
| `src/cli/commands/run.ts` | Read `templating.strict` from settings, pass to runner |
| `src/cli/commands/resume.ts` | Same as run.ts |
| `tests/prompts/template.test.ts` | Rewritten — conditionals, loops, strict/lenient, errors |
| `tests/prompts/builder.test.ts` | Update calls to pass `TemplateOptions` |
| `package.json` | Add `handlebars` dependency |

### 8. Backward Compatibility

Existing templates require zero changes. `noEscape: true` means `{{var}}` outputs raw strings as before. Lenient mode (`strict: false`, the default) means missing variables silently pass through. The `inputs.*` namespace continues to work unchanged since `WorkflowEnv` already has `inputs` as a top-level key.

### 9. What Is Not Included

- Partials/includes (`{{> partial}}`) — out of scope
- Custom helpers — out of scope
- `lookup` and `log` built-in helpers — out of scope
- Template inheritance or layouts — out of scope
- Raw/verbatim blocks — out of scope
