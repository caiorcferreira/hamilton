# Model Aliases

Map short names to full model IDs for use in agent manifests and workflow YAMLs.

## Configuration

```yaml
# ~/.hamilton/settings.yaml
models:
  aliases:
    fast: google.gemini-flash-2
    balanced: anthropic.claude-sonnet-4
    powerful: anthropic.claude-opus-4
```

## Usage in Agent Manifests

```yaml
# agent.yml
spec:
  settings:
    model: balanced    # resolves to anthropic.claude-sonnet-4
```

## Resolution Chain

1. Check `models.aliases` in settings.yaml for a matching key
2. Recursively resolve until a non-alias value is found
3. Return `"default"` or the raw value if no alias matches

## Model Selection Strategy

- Use `fast` for setup tasks (branch creation, build discovery) -- quick, low-token tasks
- Use `balanced` for implementation tasks (bug fixing, feature development)
- Use `powerful` for analysis tasks (planning, security auditing, verification)
- Use `default` to delegate to the Pi SDK default model

## Circular Reference Detection

```yaml
models:
  aliases:
    a: b
    b: a          # ERROR: CircularModelAliasError detected at load time
```
