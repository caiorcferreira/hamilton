# Capability: artifact-templates

## Overview

Every artifact shape Hamilton produces is defined once, as a template that ships inside the distribution's bundle and installs globally. `hamilton setup` copies the bundle's templates tree to `~/.hamilton/templates/`, and the step that produces an artifact reads its shape from there rather than carrying a copy in its own body. This capability covers the shapes themselves, the installation that puts them on a user's machine, and the report that tells the user what landed.

## Contract

### Layout and naming

The templates tree **is** the manifest; there is no separate index file enumerating the set. A template's path relative to the templates root is its identity — the name a skill cites, the name the install report prints, and the name preserved through installation. Depth is free: shapes belonging to one producer are grouped in a subdirectory named for it, so `wayfinder/map.md` in the bundle installs to `~/.hamilton/templates/wayfinder/map.md`, while the pipeline's own templates sit at the root and are named bare (`plan.md`).

Names are reported with `/` as the separator on every platform, so the name a user reads is the name a skill or document would cite.

### The wayfinder artifact shapes

Three shapes serve the pre-pipeline wayfinding stage. Their frontmatter is a parsed interface, not decoration — the fields and their vocabularies are what a reader or a skill matches on.

| template | frontmatter | body |
|----------|-------------|------|
| `wayfinder/map.md` | `status`: `open` \| `cleared` \| `shipping` \| `shipped`; `branch`: the branch the effort works from and merges back into, set at map creation | the sections Destination, Notes, Operation rules, Decisions so far, Not yet specified, Out of scope — in that order, and no seventh |
| `wayfinder/ticket.md` | `type`: `grilling` \| `research` \| `prototype` \| `task`; `status`: `open` \| `claimed` \| `resolved`; `blocked_by`: a list of ticket numbers | a `## Question` section |
| `wayfinder/route.md` | none | a preamble, then `## Shipping rules` — how the units will be shipped: the branch they merge back into (seeded from the map's `branch`), commit and merge/PR conventions, and any standing constraint every unit's shipping inherits — then `## Units`, each unit carrying its name, a `Status` of `pending` \| `in-progress` \| `shipped`, its dependencies, links to the decisions backing it, and a goal paragraph |

A map links its route from Destination once one exists; the route does not earn a section of its own. The map's Operation rules section holds prescriptive, per-session-binding rules on how working sessions operate and may be empty; its hints distinguish it from Notes, which holds orienting context. A ticket templates only the question — the answer is appended when the ticket resolves, so there is no empty Answer heading to invert that order. The route carries no frontmatter and no route-level status, because the effort's lifecycle belongs to the map; its Shipping rules section is what keeps the route self-contained for processes that never open the map.

### The template idiom

Every template, wayfinder's included, opens with a comment block naming the artifact, the skill that produces it, and where instances of it live, and instructs the author to delete that block and every inline hint before finalizing. The hints are inline comments in the body, so a half-filled artifact still parses as the document it will become.

## Behavior

`hamilton setup` installs the bundle's entire templates tree into `~/.hamilton/templates/`, at any depth, and overwrites what is already there — so an existing installation picks up new templates on the next run without any migration. It then reports the set it installed, naming every file by its path relative to the templates root and no directories.

The report describes what landed on disk rather than what the bundle asked for, so a file that failed to arrive is not announced as installed. A bundle carrying no templates directory at all is not an error: setup succeeds and reports an empty set.

**Examples**

- bundle templates root contains `wayfinder/map.md` -> `~/.hamilton/templates/wayfinder/map.md` exists with the bundled file's contents
- run setup a second time -> every template, nested or top-level, matches the bundle and the command succeeds
- bundle root has no templates directory -> setup succeeds, installs nothing, reports an empty set
- templates root holds nine files plus one subdirectory of three -> the report holds twelve entries, and the subdirectory's own name is not among them
- a template at the templates root -> reported as `plan.md`, with no directory prefix
- a template one level down -> reported as `wayfinder/map.md`, with `/` on every platform

## Invariants

- Every file the bundle's templates tree carries MUST install, at any depth, with its path relative to the templates root preserved.
- The install report MUST name every file installed and NEVER a directory, so its entry count equals the number of files written.
- An artifact shape MUST be defined exactly once, in the bundle's templates tree. A shape is NEVER reverse-engineered from a live instance, which cannot distinguish the required from the incidental.

## Decisions

- **The directory is the manifest.** The set of shipped shapes is whatever the templates tree contains — no manifest file, no per-producer registry, and no template-resolution layer. A grouping subdirectory is a path, not a namespace to be registered; the first one does not justify machinery for a second.
- **The report reads the destination, not the request.** Enumerating what was written, rather than replaying what was asked for, is what makes the report evidence. A report derived from the source would name a file that never arrived.
- **A template encodes the artifact's syntax, not the contract that governs it.** Fields and their allowed values belong in the template so an author fills them in correctly; the prose explaining what a value *signifies* belongs in documentation, which has one copy and can be revised. Restating a contract inside a template would stamp it into every instance ever created and make a future edit a rewrite of all of them.
- **A status field belongs to exactly one artifact.** Where two artifacts describe the same lifecycle, the one that owns it carries the status and the other links to it. A mirrored status is a value with two sources that drift apart, and templating one propagates the drift.
- **A shape templates only what exists at creation time.** A section filled in at a later stage of the artifact's life is not stubbed out in advance; an empty heading invites it to be filled in the wrong order.
- **Documentation for a template set follows the producer, not the directory.** A change to the pipeline's templates is documented with the framework; a change under a producer's subdirectory is documented with that producer's skill. `CONTRIBUTING.md`'s mapping table carries the more specific path so the intended match is unambiguous.
