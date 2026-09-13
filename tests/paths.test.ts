import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { hamiltonHome, templatesDir, guidelinesDir, settingsPath } from "../src/paths.js"

describe("paths", () => {
  const originalHome = process.env.HOME

  beforeEach(() => {
    process.env.HOME = "/tmp/test-home"
  })

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
  })

  it("hamiltonHome returns ~/.hamilton", () => {
    expect(hamiltonHome()).toBe("/tmp/test-home/.hamilton")
  })

  it("templatesDir returns ~/.hamilton/templates", () => {
    expect(templatesDir()).toBe("/tmp/test-home/.hamilton/templates")
  })

  it("guidelinesDir returns ~/.hamilton/guidelines", () => {
    expect(guidelinesDir()).toBe("/tmp/test-home/.hamilton/guidelines")
  })

  it("settingsPath returns ~/.hamilton/settings.yaml", () => {
    expect(settingsPath()).toBe("/tmp/test-home/.hamilton/settings.yaml")
  })
})
