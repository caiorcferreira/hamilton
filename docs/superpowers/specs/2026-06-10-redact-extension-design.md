# Redact Extension — Secret Detection via secretlint

## Goal

Implement a Pi SDK extension that scans tool output for secrets using `@secretlint/core` with the recommended preset, redacts detected secrets with `[REDACTED:Type]` placeholders, and runs automatically on every workflow.

Modeled after [@spences10/pi-redact](https://github.com/spences10/my-pi/blob/main/packages/pi-redact/README.md), but using `secretlint` for detection instead of regex patterns.

## Activation

Always-on. No settings YAML entry, no workflow-level flag. The extension is pushed unconditionally into the `extensionFactories` array in `pi-executor.ts`.

## Detection Engine

Uses `lintSource` from `@secretlint/core` with `@secretlint/secretlint-rule-preset-recommend` as the sole rule set. No user-facing configuration. No custom regex patterns.

The preset covers: AWS, GCP, GitHub, Slack, npm, SSH private keys, OpenAI, Stripe, SendGrid, basic auth, database connection strings, Shopify, Linear, 1Password, and more.

## Dependencies

Add to `package.json` (exact versions, no `^` or `~`):

```
@secretlint/core
@secretlint/secretlint-rule-preset-recommend
```

## File Structure

```
src/executors/pi/extensions/
  redact-extension.ts         # createRedactExtension() → (pi: ExtensionAPI) => void

tests/executors/pi/
  redact-extension.test.ts    # vitest, mock lintSource
```

No new entries in `tests/executors/pi/extensions.test.ts` — this extension is not settings-driven, so it doesn't go through `buildExtensions()`.

## Extension Logic

### Hook Point

`pi.on("tool_result")` — fires after any tool executes. The handler receives `ToolResultEvent` and can return `ToolResultEventResult` to mutate `content`, `details`, or `isError`.

### Signature

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { lintSource } from "@secretlint/core"
import { creator } from "@secretlint/secretlint-rule-preset-recommend"

export function createRedactExtension(): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.on("tool_result", async (event) => {
      // scan and redact event.content
    })
  }
}
```

### Redaction Flow

For each `TextContent` block in the `event.content` array:

1. Skip if the text is shorter than 20 characters.
2. Call `lintSource()` with `noPhysicFilePath: true` and `maskSecrets: true`.
3. If `result.messages.length === 0`, continue to the next block.
4. Sort messages by `range[0]` descending (right-to-left) to preserve character offsets during replacement.
5. For each message, replace the character range with `[REDACTED:<messageId>]`.
6. Return `{ content: mutatedContent }` if any block was modified; otherwise return `undefined`.

ImageContent blocks are passed through untouched.

### Example

```
Input:  "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nGITHUB_TOKEN=ghp_abc123def456\n"
Output: "AWS_ACCESS_KEY_ID=[REDACTED:AWSAccessKeyID]\nGITHUB_TOKEN=[REDACTED:GitHubToken]\n"
```

## Error Handling

- `lintSource()` throws → catch error, log warning to JSONL observability stream, return output unredacted.
- 2 second timeout on `lintSource()` via `Promise.race` with an `AbortController` → log warning, return output unredacted.
- The extension must never throw or reject — the agent pipeline continues regardless.

## Wiring in pi-executor.ts

After the existing `extensionFactories` array is built and the workflow extension is pushed:

```typescript
extensionFactories.push(createRedactExtension())
```

No conditional logic. No imports from `extensions.ts`.

## Testing

Test file: `tests/executors/pi/redact-extension.test.ts`

Uses vitest with `globals: false`. Mocks `@secretlint/core` via `vi.mock`.

| Test Case | Setup | Assertion |
|---|---|---|
| No secrets found | `lintSource` returns `{ messages: [] }` | Content passes through unchanged, handler returns `undefined` |
| Single secret found | `lintSource` returns one message with range | Text has `[REDACTED:Type]` at the correct position |
| Multiple secrets found | `lintSource` returns 2+ messages | All redacted, right-to-left offset handling verified |
| `lintSource` throws | Mock rejects | Output passes through unredacted, no exception propagates |
| Timeout | Mock hangs beyond 2s | Output passes through unredacted |
| Short text (< 20 chars) | Text is "abc123" | `lintSource` is never called |
| Mixed text + image content | Content has both types | Image blocks untouched, text blocks scanned |
| No text blocks (images only) | All content is images | `lintSource` never called, handler returns `undefined` |

## Limitations

- Does not scan user input or LLM responses — only tool output.
- Detection quality depends on secretlint's rule set. Novel or custom token formats may not be caught.
- 2 second timeout means very large tool outputs may pass through unscanned.
