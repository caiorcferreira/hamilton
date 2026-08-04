# Read the three upstream sibling skills

Type: research
Status: open
Blocked by: —

## Question

What do the upstream `research`, `prototype` and `domain-modeling` skills actually do, and what
would each cost to bring into Hamilton?

None of the three is installed on this machine; all three exist in
[mattpocock/skills](https://github.com/mattpocock/skills/tree/main/skills/engineering) under MIT.

For each skill, surface:

- Its full `SKILL.md`, plus any `references/` or `agents/` files.
- What it depends on — other skills it invokes, repo config files it reads (`docs/agents/*.md`,
  `CONTEXT.md`, `docs/adr/`), and any tool it names.
- Whether it is HITL or AFK, and what artifacts it writes.
- The specific collisions with Hamilton's model. `domain-modeling` is the known one: it writes
  `CONTEXT.md` and `docs/adr/`, whereas Hamilton keeps durable truth in `.hamilton/specs/` and
  standing rules in `AGENTS.md` — so a port either introduces a parallel doc system or has to be
  re-homed onto Hamilton's artifacts.
- Its size, so the porting effort can be judged.

This is a facts-only ticket. It decides nothing; it feeds
[Which siblings to port, and their Hamilton shape](07-which-siblings-to-port.md).

Findings go under `## Answer` below, with enough detail that ticket 07 can be resolved without
re-fetching.
