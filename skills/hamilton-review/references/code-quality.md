# Code quality reference

A review rubric for the **code under review** — the structural quality of the diff itself. By
review time the design and plan are fixed; what remains to judge is whether the code the coder
wrote honors that structure and reads cleanly. Use this to turn "this feels off" into a
located, named finding a coder can act on without guessing.

## How to use this

- While inspecting the diff, walk each principle and check the changed code for the **smell** —
  a trigger you can point at a line, not a vibe. If it trips, raise it as feedback naming the
  file and place, tagged blocking (it will bite) or suggestion (a smell without a present
  cost), with the **fix** as the suggested change.
- **Scale scrutiny to the change.** A mechanical or one-file diff trips few of these; a new
  subsystem trips many. Proportionality is itself a quality principle — do not demand
  gold-plating on a small change. When in doubt, spend the scrutiny on decomposition and
  boundaries, the expensive things to get wrong.
- **Structural defects that trace to the design are the design's problem, not the coder's.** If
  the smell is baked into what the plan mandated, say so beside the plan text and flag it as a
  plan/design issue rather than asking the coder to deviate — the coder executes steps verbatim
  and cannot invent quality the plan did not encode.
- **The vocabulary is paradigm-neutral.** "A unit" means a module, class, or function,
  whichever the codebase uses. Read "depends on an abstraction" as an interface, a passed
  function, or an injected effect, as the code demands.

## Principles

Each entry states the principle in one line, then the **smell** to look for in the diff and the
**fix**, on their own lines.

### Single responsibility (cohesion)
A unit has one reason to change.
- **Smell:** you cannot state a function's or module's job without "and"; one commit mixes
  unrelated changes.
- **Fix:** split along the axes that change independently — one unit per reason to change.

### Low coupling / clear boundaries
Units depend on as little of each other as possible, through narrow interfaces.
- **Smell:** code reaches into another module's internals; a concrete, mutable structure is
  passed across a boundary; a small change here forces edits across many files.
- **Fix:** narrow the interface and hide what is behind it, so internals can change without
  breaking consumers.

### Dependency inversion & testable seams
High-level policy depends on abstractions, not concrete details, and every unit has a seam
where a test can substitute its collaborators.
- **Smell:** core logic constructs or names a concrete IO/DB/clock/network/randomness source
  directly; behavior the tests can only exercise with real IO.
- **Fix:** inject the dependency behind an interface or parameter so a test can substitute it.

### Open for extension
Adding a case does not mean editing the branching of the existing one.
- **Smell:** a new `switch`/`if`-arm added per type; a change that reads "to add X you edit
  function Y."
- **Fix:** polymorphism, a lookup table, or a registry so new cases are additive.

### Substitutability
Every variant honors the contract its callers rely on; no caller needs to know which variant it
holds.
- **Smell:** an implementation that throws on or silently no-ops part of the interface; callers
  that type-check the concrete variant before acting.
- **Fix:** rethink the hierarchy, or narrow the interface to what all variants truly share.

### Interface segregation
A client depends only on what it uses.
- **Smell:** a fat interface whose implementers stub half its methods; a caller pulled into
  depending on a large module for one function.
- **Fix:** split into role-specific interfaces sized to each client.

### DRY / single source of truth
Each piece of knowledge — a rule, a constant, a shape — has one authoritative definition.
- **Smell:** the same logic or value copied into two places; parallel structures that must be
  changed together to stay correct.
- **Fix:** name it once and reference it.
- **Counter:** do not merge things that are only incidentally alike today; that couples them for
  no reason.

### Right-sized abstraction (YAGNI)
Structure matches real, present need — and no more.
- **Smell:** a layer, generic, config knob, or extension point with exactly one caller and no
  requirement asking for a second.
- **Fix:** cut it; add the seam when the second case actually arrives. This is the counterweight
  to every principle above — apply them to remove concrete pain, never to speculate.

### Intention-revealing names
Names state purpose.
- **Smell:** `data`, `manager`, `helper`, `process()`, boolean flags whose meaning you must
  trace the code to recover.
- **Fix:** rename to the domain concept the reader is looking for.

### Explicit error and edge handling
Failure modes are handled, not incidental.
- **Smell:** only a happy path; errors swallowed or flattened into strings; an edge case with
  no test.
- **Fix:** handle failure → expected behavior, and cover each with a test.

### Complexity budget
Prefer the simplest structure that solves the actual problem; watch size, nesting, and
indirection.
- **Smell:** a function that outgrows a screen or nests past a few levels; more layers of
  indirection than the problem has moving parts.
- **Fix:** decompose, flatten with early returns, or remove the indirection.

## What this judges

The **diff under review** — the code the coder actually wrote. Structure, boundaries, naming,
and error handling are what this rubric scores; correctness, tests, security, and scope are
covered by the other review dimensions in `SKILL.md`. A finding here cites the file and place
like any other, and is tagged blocking or suggestion.
