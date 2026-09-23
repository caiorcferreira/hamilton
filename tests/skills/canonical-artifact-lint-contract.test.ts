import { describe, expect, it } from "vitest"
import { readSkill } from "./helpers.js"

const writers = [
  "hamilton-compose-spec",
  "hamilton-wayfinder",
  "hamilton-wayfinder-domain-modeling",
  "hamilton-wayfinder-research",
  "hamilton-wayfinder-prototype",
  "hamilton-grilling",
] as const

const readWriters = () =>
  Object.fromEntries(writers.map((name) => [name, readSkill(name)])) as Record<
    (typeof writers)[number],
    string
  >

const expectOrdered = (
  content: string,
  earlier: string,
  later: string,
): void => {
  const earlierIndex = content.indexOf(earlier)
  const laterIndex = content.indexOf(later, earlierIndex + earlier.length)

  expect(earlierIndex, `missing mutation marker: ${earlier}`).toBeGreaterThanOrEqual(0)
  expect(laterIndex, `missing lint marker: ${later}`).toBeGreaterThan(earlierIndex)
}

describe("canonical and Wayfinder artifact lint contract", () => {
  it("maps each writer to its recognized and unrelated outputs", () => {
    const skills = readWriters()

    expect(skills["hamilton-compose-spec"]).toContain(
      ".hamilton/specs/<capability>.md",
    )
    expect(skills["hamilton-compose-spec"]).toContain(
      "hamilton workbench lint --file <spec-path>",
    )

    expect(skills["hamilton-wayfinder"]).toContain(
      ".hamilton/maps/<effort>/map.md",
    )
    expect(skills["hamilton-wayfinder"]).toContain(
      ".hamilton/maps/<effort>/tickets/NN-slug.md",
    )
    expect(skills["hamilton-wayfinder"]).toContain(
      ".hamilton/maps/<effort>/route.md",
    )
    expect(skills["hamilton-wayfinder"]).toContain(
      "hamilton workbench lint --file <map-path>",
    )
    expect(skills["hamilton-wayfinder"]).toContain(
      "hamilton workbench lint --file <ticket-path>",
    )
    expect(skills["hamilton-wayfinder"]).toContain(
      "hamilton workbench lint --file <route-path>",
    )

    expect(skills["hamilton-wayfinder-domain-modeling"]).toContain(
      ".hamilton/specs/glossary.md",
    )
    expect(skills["hamilton-wayfinder-domain-modeling"]).toContain(
      ".hamilton/maps/<effort>/tickets/NN-slug.md",
    )
    expect(skills["hamilton-wayfinder-domain-modeling"]).toContain(
      "hamilton workbench lint --file <ticket-path>",
    )

    expect(skills["hamilton-wayfinder-research"]).toContain(
      ".hamilton/maps/<effort>/research/",
    )
    expect(skills["hamilton-wayfinder-research"]).toContain(
      "hamilton workbench lint --file <ticket-path>",
    )
    expect(skills["hamilton-wayfinder-research"]).toMatch(
      /research notes.*(?:remain|are) outside lint scope|do not lint.*research notes/is,
    )
    expect(skills["hamilton-wayfinder-research"]).toMatch(
      /only when.*ticket.*(?:mutated|edited)|if.*ticket.*(?:mutated|edited)/is,
    )

    expect(skills["hamilton-wayfinder-prototype"]).toContain(
      "prototype/<map>/<ticket>",
    )
    expect(skills["hamilton-wayfinder-prototype"]).toContain(
      "hamilton workbench lint --file <ticket-path>",
    )
    expect(skills["hamilton-wayfinder-prototype"]).toMatch(
      /throwaway.*(?:remain|are) outside lint scope|do not lint.*throwaway/is,
    )

    expect(skills["hamilton-grilling"]).toContain("ticket's `## Answer`")
    expect(skills["hamilton-grilling"]).toContain(
      "hamilton workbench lint --file <ticket-path>",
    )
  })

  it("runs scoped lint after recognized mutations and before handoff", () => {
    const skills = readWriters()

    expectOrdered(
      skills["hamilton-compose-spec"],
      "After writing or editing each canonical spec",
      "hamilton workbench lint --file <spec-path>",
    )
    expectOrdered(
      skills["hamilton-wayfinder"],
      "After each write or edit of a map, ticket, or route",
      "hamilton workbench lint --file <map-path>",
    )
    expectOrdered(
      skills["hamilton-wayfinder-domain-modeling"],
      "After each canonical glossary or ticket mutation",
      "hamilton workbench lint --file <ticket-path>",
    )
    expectOrdered(
      skills["hamilton-wayfinder-research"],
      "If the resolving ticket is edited",
      "hamilton workbench lint --file <ticket-path>",
    )
    expectOrdered(
      skills["hamilton-wayfinder-prototype"],
      "If the resolving ticket is edited",
      "hamilton workbench lint --file <ticket-path>",
    )
    expectOrdered(
      skills["hamilton-grilling"],
      "When the answer is written to a recognized ticket",
      "hamilton workbench lint --file <ticket-path>",
    )

    for (const name of writers) {
      expect(skills[name]).toMatch(/nonzero.*lint|lint.*nonzero/is)
      expect(skills[name]).toMatch(/resolve.*finding|finding.*(?:resolve|rerun)|exact blocker/is)
      expect(skills[name]).toMatch(/before[\s\S]{0,60}(?:handoff|commit)/i)
    }
  })

  it("keeps author attribution explicit for author-bearing canonical specs", () => {
    const composeSpec = readWriters()["hamilton-compose-spec"]

    expect(composeSpec).toMatch(
      /git config user\.name[\s\S]*git config user\.email/i,
    )
    expect(composeSpec).toMatch(
      /preserve.*(?:recorded|existing).*author|author.*preserve.*(?:recorded|existing)/is,
    )
    expect(composeSpec).toMatch(
      /missing.*identity[\s\S]*(?:stop|report)[\s\S]*(?:not|never) invent/is,
    )
  })
})
