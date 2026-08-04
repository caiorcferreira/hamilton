# Template convention: inline vs bundle/templates/

Type: grilling
Status: open
Blocked by: 01

## Question

Do the map, ticket and route artifact shapes become Hamilton templates in `bundle/templates/`, or
stay embedded in `hamilton-wayfinder/SKILL.md` the way upstream embeds them?

The two conventions genuinely conflict. `docs/sdd-framework.md` states: "Templates are global. The
canonical set lives in the repository's `bundle/templates/` and is copied to `~/.hamilton/templates/`
by the `hamilton setup` command. Every step reads the installed copy, so there is one definition of
each artifact's shape." Upstream wayfinder instead carries its map and ticket bodies inline, which
is what makes it self-contained and installable anywhere.

Settle:

- Inline, templated, or split (map templated because it is long-lived; tickets inline because they
  are one heading)?
- If templated: which files — `map.md`, `ticket.md`, `route.md`? And does a user who installed the
  skill but never ran `hamilton setup` get a broken skill? That is a new failure mode for a stage
  that runs *before* `hamilton-init`.
- If inline: is the divergence from the stated convention acknowledged in the docs, or does the
  convention itself get amended to "per-change artifacts are templated; planning artifacts are not"?
- Knock-on effects to name for the fog: `tests/cli/setup.test.ts` asserts what `hamilton setup`
  installs, and `CONTRIBUTING.md` maps `bundle/templates/` changes to `docs/sdd-framework.md`.

Note the ordering problem either way: this stage precedes `hamilton-init`, so it cannot assume the
project has been initialised.
