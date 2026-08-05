# Progress: Land the glossary

## Task 1: Write `.hamilton/specs/glossary.md` — 2026-08-05

- Outcome: done
- Changed:
  - Created: `.hamilton/specs/glossary.md`
  - Modified: none
  - Deleted: none
- Verified: `grep -nE 'SHALL|WHEN|THEN' .hamilton/specs/glossary.md` → no matches (exit 1);
  `grep -n '^## '` → the three clusters in the specified order (The map and its parts / Working the
  map / From map to code); ten bolded entries covering the eleven terms, with *unit* folded into
  *change-sized unit* as its route-time shorthand per the plan; every relative link target resolves
  on disk (`map.md` plus tickets 01, 04, 06, 08); `bun run build` → exit 0;
  `bun --bun vitest run` → 23 passed (3 files), unchanged.
- Notes: One wording call worth a reviewer's eye. Ticket 04's *Claiming stays* subsection ends
  "claiming does not change the frontier calculation: a claimed ticket is still open, not unblocked
  or resolved" — but the wayfinder skill defines the frontier as the open, **unblocked, unclaimed**
  tickets, which the plan directs the *frontier* entry to use. Taken literally, ticket 04's sentence
  would put a claimed ticket both on and off the frontier. The glossary's *claim* entry therefore
  states only the unambiguous half — "a claimed ticket is still open, not resolved" — and does not
  assert anything about the frontier calculation, so neither entry contradicts the other and nothing
  is invented past the source. The separate contradiction the plan already flagged (ticket 04's
  one-line Answer header says "Tickets drop claiming", against its own *Claiming stays* subsection
  and `map.md`'s Decisions-so-far gist) was handled as instructed: the subsection and the map's gist
  govern, and the slip is not surfaced inside the glossary entry.
