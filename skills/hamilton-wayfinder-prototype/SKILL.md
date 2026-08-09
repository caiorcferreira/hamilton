---
name: hamilton-wayfinder-prototype
description: Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like.
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## Pick the shape

First identify the *question* — from the user's prompt, the surrounding code, or by asking if the user is around. Two broad flavours:

- **"Does this logic / state model feel right?"** — the question has a logic or state-model feel. You want to push real cases through a model and see where it breaks.
- **"What should this look like?"** — the question is about appearance, layout, or structure. You want to generate alternatives and compare them side by side.

Then pick a throwaway shape appropriate to the project's *domain and stack* — the shape that lets someone push the real cases and see the state change with the least ceremony:

- **Frontend projects** — two detailed guides:
  - [FRONTEND_LOGIC.md](references/FRONTEND_LOGIC.md) — a single shareable HTML file driving a state model: free-play buttons plus tabbed guided walkthroughs, pushable by a non-developer.
  - [FRONTEND_UI.md](references/FRONTEND_UI.md) — several radically different UI variations on a single route, switchable via a URL search param and a floating bottom bar.
- **Other domains** (backend, data, CLI, etc.) — pick the equivalent throwaway shape: a script, a notebook, a CLI harness, whatever lets someone push the real cases and see the state change. The same two flavours apply — a logic probe vs. a structural comparison — but the artifact is whatever the stack makes trivial to run and throw away.

The two flavours produce very different artifacts — getting this wrong wastes the whole prototype. If the question is genuinely ambiguous and the user isn't reachable, default to the shape that best matches the surrounding code (a backend module → a logic/script shape; a page or component → a UI shape) and state the assumption at the top of the prototype.

## Rules that apply to every prototype

1. **Throwaway from day one, and clearly marked as such.** Locate the prototype code close to where it will actually be used (next to the module, page, or pipeline it's prototyping for) so context is obvious — but name it so a casual reader can see it's a prototype, not production. Follow whatever conventions the project already uses for throwaway artifacts; don't invent a new top-level structure.
2. **Trivial to run.** One command in the project's task runner — `pnpm <name>`, `python <path>`, `bun <path>`, etc. — or a single file the user double-clicks. No thinking required to start it.
3. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file with a clear "PROTOTYPE — wipe me" name.
4. **Skip the polish.** No tests, no error handling beyond what makes the prototype _runnable_, no abstractions. The point is to learn something fast.
5. **Surface the state.** After every action or variant switch, print or render the full relevant state so the user can see what changed.
6. **Capture it when done.** Fold any validated decision into the real code, then capture the prototype itself as a **primary source**: commit it to a throwaway branch, out of main, and leave a context pointer to that branch in the resolving ticket's body. Capture the answer too — the verdict and the question it settled — in that ticket's `## Answer`. The main branch keeps only the validated decision.
