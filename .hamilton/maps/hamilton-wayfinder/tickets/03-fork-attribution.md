# Fork attribution and licensing

Type: grilling
Status: open
Blocked by: —

## Question

How does Hamilton credit the upstream skills it forks, and where does that credit live?

Established facts: [mattpocock/skills](https://github.com/mattpocock/skills) is MIT licensed and
its README explicitly invites copying and adapting. MIT requires the copyright notice and licence
text to travel with substantial portions of the work — so the question is form and placement, not
permission.

Settle:

- Does Hamilton carry a `NOTICE`/`THIRD-PARTY.md`, an attribution line in each forked `SKILL.md`,
  a credit in `README.md`, or some combination?
- Hamilton's own licence — check what `package.json` and the repo declare, and whether it is
  MIT-compatible.
- `docs/sdd-framework.md` already has an **Inspirations** section crediting OpenSpec, Superpowers,
  Spec Kit and others in prose. Is a fork materially different from an inspiration, and does it
  belong in that section or somewhere more formal?
- Whether this applies once (a repo-level notice) or per forked skill.

Small ticket. It blocks nothing structurally, but the answer has to exist before anything ships.
