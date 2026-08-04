# Map mechanics in files: claim, block, frontier, resolve

Type: grilling
Status: open
Blocked by: 01

## Question

How do upstream wayfinder's tracker-native mechanics translate into file conventions, and what
exactly goes in the single `## Map mechanics` section that keeps them swappable?

Upstream leans on the tracker for five things Hamilton has no equivalent of:

| Upstream | Provided by | Needs a file answer |
|---|---|---|
| `wayfinder:map` label | tracker labels | how a map file is identified |
| Ticket type (`wayfinder:<type>`) | tracker labels | a `Type:` line? front matter? |
| Claim | issue assignee | a `Status: claimed` line — and who "you" is, solo |
| Blocking | **native** dependency edges | a `Blocked by:` line |
| Frontier | tracker query | a directory scan |

Settle:

- The exact field syntax — loose `Key: value` lines like upstream's local-markdown convention, or
  YAML front matter, which the rest of Hamilton does not use in artifacts but skills do.
- Whether **claiming survives at all.** Upstream claims because concurrent sessions share one
  tracker. A file-based map in one repo may not need it — and if two worktrees hold divergent
  copies, a `Status: claimed` line does not prevent anything. Dropping it is a legitimate answer;
  keeping it needs a reason.
- Open/closed representation — a `Status:` value, moving the file to a `resolved/` directory, or
  something else. It must make "closed" unambiguous, since out-of-scope tickets are *closed* to
  take them off the frontier.
- Where the resolution answer lands: appended under `## Answer` in the ticket, plus the one-line
  gist in the map's Decisions-so-far.
- The boundary of the `## Map mechanics` section — precisely what a future tracker backend would
  replace, so the pluggability promise is real rather than aspirational.

Upstream's `issue-tracker-local.md` is prior art for most of this and worth reading first; the
question is which parts of it Hamilton adopts verbatim and which it changes.
