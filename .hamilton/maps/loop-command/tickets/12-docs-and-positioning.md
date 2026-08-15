---
type: grilling
status: open
blocked_by: ["07", "09"]
---

# Documentation and positioning

## Question

The loop changes what Hamilton *is*, and the existing docs actively contradict it.

- **`docs/modes.md` says Hamilton has "a single mode: Assisted"** and that the Autonomous workflow
  engine "was removed". A background loop that drives agents autonomously is, by any plain reading,
  a second mode. Is it named as one — reviving "Autonomous" as a term, coining a new one, or
  folding it under Assisted as tooling? Reviving the old name carries baggage: the removed engine
  was a different thing, and the archive branch still exists.
- **`docs/skills.md` describes the pipeline** as six core skills plus wayfinder, all tool-agnostic
  markdown that "names no tool and depends on no engine internals". The `sdd` topology names tools
  and depends on engine internals by construction. Where does it sit in that document — a new
  section, or a note on the pipeline diagram?
- **The `hamilton-orchestrate` pair.** Whatever boundary ticket 07 fixes has to be written where a
  user choosing between them will read it.
- **CLI identity.** `README.md`, `docs/modes.md`, and `CONTRIBUTING.md` all describe a
  template-setup CLI. The `hamilton-wayfinder` map's Out of scope section rejected a maps CLI
  partly because "`hamilton` is a template-installer with one subcommand". That premise is now
  deliberately overturned — does anything need saying there, or is a superseding decision in this
  map enough?
- **Is a capability spec needed?** `.hamilton/specs/` holds capability specs (`cli-distribution`,
  `propose`, `dialogue`...). Does the loop earn one, and does it go through `hamilton-compose-spec`
  or fall out of the route's units naturally?
- **Ralph attribution.** The technique is Geoffrey Huntley's and the name is his coinage. The repo
  already has a formal attribution posture (`NOTICE`, per-skill `NOTICE` files) from the wayfinder
  fork. Does naming a topology `ralph` need attribution, and of what kind — prose credit in docs,
  or something in `NOTICE`?

## Answer

## Outdated decisions
