import { describe, it, expect, vi, beforeEach } from "vitest"
import { createRtkExtension } from "../../../src/executors/pi/extensions/rtk-extension.js"
import * as ChildProcess from "node:child_process"

vi.mock("node:child_process")

describe("createRtkExtension", () => {
  it("returns a function (the extension factory)", () => {
    const factory = createRtkExtension({})
    expect(typeof factory).toBe("function")
  })

  it("returns no-op when disabled", () => {
    const factory = createRtkExtension({ disabled: true })
    const mockPi = { on: vi.fn() }
    factory(mockPi as any)
    expect(mockPi.on).not.toHaveBeenCalled()
  })

  describe("when enabled", () => {
    let handler: Function
    let mockPi: { on: ReturnType<typeof vi.fn> }

    beforeEach(() => {
      handler = () => {}
      mockPi = {
        on: vi.fn((event: string, h: Function) => { handler = h })
      }
      vi.mocked(ChildProcess.spawnSync).mockReturnValue({
        status: 0,
        stdout: "",
        stderr: "",
        output: [],
        pid: 1,
        signal: null
      } as any)
    })

    it("registers a tool_call listener", () => {
      const factory = createRtkExtension({})
      factory(mockPi as any)
      expect(mockPi.on).toHaveBeenCalledWith("tool_call", expect.any(Function))
    })

    it("does nothing for non-bash tool calls", () => {
      const factory = createRtkExtension({})
      factory(mockPi as any)

      const event = { toolName: "read", input: { path: "foo.txt" } }
      handler(event)

      expect(ChildProcess.spawnSync).not.toHaveBeenCalled()
    })

    it("calls rewriteCommand for bash tool calls", () => {
      const factory = createRtkExtension({})
      factory(mockPi as any)

      const command = "npm install"
      const event = { toolName: "bash", input: { command } }
      handler(event)

      expect(ChildProcess.spawnSync).toHaveBeenCalledWith("rtk", ["rewrite", command], expect.any(Object))
    })
  })
})