import { describe, it, expect, vi } from "vitest"
import { createGitExtension } from "../../../src/executors/pi/extensions/git-extension.js"

describe("createGitExtension", () => {
  it("registers the git_diff tool on pi", () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createGitExtension("/tmp/repo")
    ext(mockPi as any)

    expect(registerTool).toHaveBeenCalledWith(expect.objectContaining({
      name: "git_diff",
      label: "Git Diff"
    }))
  })

  it("git_diff tool returns unstaged diff output when staged=false", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createGitExtension("/tmp/repo")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    const result = await toolDef.execute("call-1", { staged: false }, undefined, undefined, {} as any)

    expect(result.content[0].type).toBe("text")
    expect(typeof (result.content[0] as { type: "text"; text: string }).text).toBe("string")
  })

  it("git_diff tool returns staged diff when staged=true", async () => {
    const registerTool = vi.fn()
    const mockPi = { registerTool }

    const ext = createGitExtension("/tmp/repo")
    ext(mockPi as any)

    const toolDef = registerTool.mock.calls[0][0]
    const result = await toolDef.execute("call-1", { staged: true }, undefined, undefined, {} as any)

    expect(result.content[0].type).toBe("text")
  })
})
