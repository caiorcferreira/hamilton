---
name: hamilton-wayfinder-research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.
---

Spin up a **background agent** to do the research, so you keep working while it reads.

Its job:

1. Investigate the question against **primary sources** — official docs, source code, specs, first-party APIs — not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it to `.hamilton/maps/<effort>/research/`, where `<effort>` is the map being worked.

## Process flow

```dot
digraph hamilton_wayfinder_research {
    "Dispatch background agent" [shape=box];
    "Investigate against primary sources\n(follow each claim to its source)" [shape=box];
    "Write findings Markdown\nciting each claim's source" [shape=box];
    "Save to .hamilton/maps/<effort>/research/" [shape=doublecircle];

    "Dispatch background agent" -> "Investigate against primary sources\n(follow each claim to its source)";
    "Investigate against primary sources\n(follow each claim to its source)" -> "Write findings Markdown\nciting each claim's source";
    "Write findings Markdown\nciting each claim's source" -> "Save to .hamilton/maps/<effort>/research/";
}
```
