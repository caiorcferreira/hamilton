# Ticket types in the Hamilton fork

Type: grilling
Status: open
Blocked by: 07

## Question

Which ticket types does `hamilton-wayfinder` keep, and what are they called?

Upstream has four — `research`, `prototype`, `grilling`, `task` — split across HITL (worked with a
human who speaks for themselves) and AFK (agent alone). Each type is defined by the skill it
delegates to, so [Which siblings to port](07-which-siblings-to-port.md) constrains this directly:
a type whose skill was not ported has to be redefined or dropped.

Settle:

- **The set.** Do all four survive? Does `prototype` earn its place in a repo whose destination is
  usually a decision about code?
- **Naming.** "Grilling" names a technique, not a category, and it is the default case. Hamilton's
  vocabulary would more likely call it `decision`. Renaming costs fidelity to upstream and any
  shared muscle memory; keeping it imports a term Hamilton does not otherwise use. Check
  `docs/sdd-framework.md`'s ubiquitous-language posture before deciding.
- **HITL/AFK.** Upstream's rule is strict: a HITL ticket only resolves through live exchange and the
  agent never answers its own questions. Hamilton's `AGENTS.md` boundary model has a third state —
  "Ask first", resolved unattended by the agent deciding and recording its reasoning. Do the two
  reconcile, or does wayfinder keep the stricter rule?
- **Where the type is recorded** — settled mechanically by
  [Map mechanics in files](04-map-mechanics-in-files.md); this ticket only fixes the vocabulary.
