# Map artifact layout under .hamilton/

Type: grilling
Status: open
Blocked by: —

## Question

Where do maps and their tickets live under `.hamilton/`, and what is the file and directory
naming convention?

Hamilton's existing artifacts are per-change and ephemeral (`.hamilton/changes/<YYYY-MM-DD-title>/`)
or durable and per-capability (`.hamilton/specs/<capability>.md`). A map is neither: it spans
multiple changes, outlives any one of them, and dies when its destination is reached.

Settle:

- The directory — `.hamilton/maps/<effort>/` (this map's provisional guess), something under
  `changes/`, or a third shape.
- Effort slug convention — dated like changes (`2026-08-04-title`) or undated (`hamilton-wayfinder`)?
  Changes are dated because they are ephemeral; maps are longer-lived.
- Ticket files — one file per ticket in a `tickets/` subdirectory, numbered from `01`, matching
  upstream's local-markdown convention? Or a different split?
- What lives in the map body versus the ticket body, given Hamilton's "map is an index, not a
  store" inheritance.
- Whether `hamilton-init` scaffolds the map directory the way it scaffolds `specs/` and `changes/`.
- What happens to a map when its destination is reached — deleted, archived, folded into `specs/`?

Resolving this may relocate this very map. That is expected.
