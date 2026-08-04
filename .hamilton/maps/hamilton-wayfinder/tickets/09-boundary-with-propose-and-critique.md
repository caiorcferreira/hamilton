# Boundary with hamilton-propose and hamilton-critique

Type: grilling
Status: open
Blocked by: 06

## Question

Where does `hamilton-wayfinder` stop and `hamilton-propose` start, so the project has one front
door rather than two?

The overlap is real. `hamilton-propose` is already described as "the heavyweight front door": it
turns an idea into a well-formed change "through collaborative dialogue... clarifying questions one
at a time, then two or three alternative approaches with trade-offs", and gates on approval. That is
close enough to a wayfinder decision ticket that a user will reasonably ask which one to reach for.

Settle:

- **The trigger that separates them.** Size ("more than one agent session can hold") is upstream's
  answer. Is that Hamilton's, or is it "more than one change"? A crisp, stated rule matters more
  than which one is chosen.
- **What propose receives.** [route.md shape and the SDD join](06-route-shape-and-sdd-join.md) fixes
  the artifact; this ticket fixes the behaviour. Does `hamilton-propose` change to detect and read an
  upstream route unit, or does it stay untouched and the human pastes context in?
- **Whether propose can be skipped.** If wayfinder's decisions already cover the why and the how for
  a unit, running propose's full dialogue may be redundant ceremony. Does a route unit ever go
  straight to `hamilton-plan`, and who decides?
- **`hamilton-critique`.** It gates the propose artifacts. Is there an equivalent gate on a map or a
  route, or is that over-engineering for a planning artifact?
- **The one-sentence answer** to "which do I run?" that goes in `docs/skills.md`.
