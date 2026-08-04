# How the framework docs present the pre-SDD stage

Type: grilling
Status: open
Blocked by: 09

## Question

How do Hamilton's docs present a stage that sits *before* the pipeline they currently describe as
starting at `init`?

`CONTRIBUTING.md` makes documentation non-optional and maps change areas to doc files, so this is a
required decision, not a nicety. The current picture has no room for a pre-SDD stage: `README.md`,
`docs/skills.md` and `docs/sdd-framework.md` all open with the same diagram.

```
init ──▶ [ propose ] ──▶ plan ──▶ code ──▶ review ──▶ finish-work
```

Settle:

- **The diagram.** Does wayfinder enter it — and if so, before `init` (it precedes project setup) or
  before `propose` (it precedes a change)? Or does it stay off the line entirely, the way
  `hamilton-compose-spec` does as a skill that "sits outside the per-change pipeline"? That is
  existing precedent worth weighing.
- **Which docs change and how much.** A `docs/skills.md` entry in the established format is the
  floor. Does `docs/sdd-framework.md` gain a section — it is the *why* document, and a pre-SDD
  planning stage is a philosophical addition, not just another skill?
- **The pipeline's identity.** The framework calls itself six skills in a fixed sequence with the
  plan as the only required artifact. A seventh, optional, upstream stage either extends that story
  or contradicts it. Which, and how is it phrased?
- **`CONTRIBUTING.md`'s mapping table** — does it gain a row for map artifacts?
- **`ROADMAP.md` and `TODO.md`** — both currently describe Hamilton as a template-setup CLI whose
  next steps are keeping existing skills sharp. Does this effort belong there?

Decides the shape of the docs work; the writing itself is a route unit.
