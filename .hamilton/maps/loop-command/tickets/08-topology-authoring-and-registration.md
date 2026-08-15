---
type: grilling
status: open
blocked_by: ["01", "02", "06"]
---

# Topology authoring and registration

## Question

Goal #2 is "be able to easily implement new loops in the future", and the standing decision that
loops are topologies rather than config records is what justifies LangGraph. Make that concrete —
with two real topologies (06, 07) in hand rather than one.

- **What a topology is, as an artifact.** A module exporting a compiled `StateGraph`? A factory
  taking a kernel and returning a graph? A class? Fix the contract.
- **Shared state schema.** LangGraph graphs are typed by their state channels. Do all topologies
  share one state shape (iteration count, last gate result, kernel handle), or does each define its
  own with the runner handling only a common subset? This is the decision that determines whether
  "new topology" is genuinely cheap.
- **What the runner provides.** Which concerns belong to the runner and are therefore *not*
  re-implemented per topology: iteration counting, caps from 05, log routing, checkpointing,
  signal handling. A topology that has to re-implement cancellation is not cheap to write.
- **Registration and discovery.** A static map in source, a directory scan, a manifest? `--topology
  ralph` resolves how?
- **Bundled vs user-authored.** The map holds third-party topologies as fog. Decide whether v1
  closes the set. If a user can author one, it has to load from somewhere at runtime — which
  collides with the standalone-binary distribution (ticket 01) since a compiled binary cannot
  trivially import user TypeScript.
- **Naming.** `topology` is the working-glossary term and may not be the right user-facing word.
  `hamilton loop run --topology ralph` versus `hamilton loop ralph` versus `--mode`. The user-facing
  name and the internal concept need not match, but both need deciding.

## Answer

## Outdated decisions
