import type { MemoryAtom } from "./store.js"

export function buildMemoryContext(atoms: MemoryAtom[]): string {
  if (atoms.length === 0) return ""

  let context = `---
## Agent Memory — Session Context

> The following memories were retrieved from your long-term store.
> These are authoritative guidelines ingested from project instruction files.

### REFERENCE (canonical knowledge)

`

  for (const atom of atoms) {
    context += `#### [canonical] ${atom.title}
*Confidence: ${atom.confidence} | ID: ${atom.id}*

${atom.content}

---
`
  }

  context += `
*${atoms.length} atoms injected inline.*
---
`

  return context
}