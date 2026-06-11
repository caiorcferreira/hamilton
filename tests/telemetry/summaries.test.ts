import { describe, it, expect } from "vitest"
import {
  summarizeToolArgs,
  summarizeToolResult,
  summarizePayload
} from "../../src/telemetry/summaries.js"

describe("summaries", () => {
  describe("summarizeToolArgs", () => {
    it("summarizes an object with keys", () => {
      const result = summarizeToolArgs({ command: "ls", cwd: "/tmp" })
      expect(result.type).toBe("object")
      expect(result.keys).toEqual(["command", "cwd"])
    })

    it("summarizes a string", () => {
      const result = summarizeToolArgs("hello world")
      expect(result.type).toBe("string")
      expect(result.bytes).toBe(Buffer.byteLength("hello world", "utf8"))
    })

    it("summarizes null / undefined", () => {
      const result = summarizeToolArgs(null)
      expect(result.type).toBe("null")
      expect(result.bytes).toBe(0)
    })

    it("summarizes an array", () => {
      const result = summarizeToolArgs([1, 2, 3])
      expect(result.type).toBe("array")
    })

    it("summarizes a number", () => {
      const result = summarizeToolArgs(42)
      expect(result.type).toBe("number")
      expect(result.bytes).toBe(2)
    })

    it("summarizes a boolean", () => {
      const result = summarizeToolArgs(true)
      expect(result.type).toBe("boolean")
      expect(result.bytes).toBe(4)
    })
  })

  describe("summarizeToolResult", () => {
    it("summarizes string result", () => {
      const result = summarizeToolResult("file contents here")
      expect(result.type).toBe("string")
      expect(result.lines).toBe(1)
    })

    it("summarizes multiline string result", () => {
      const result = summarizeToolResult("line1\nline2\nline3")
      expect(result.lines).toBe(3)
    })

    it("summarizes object result with keys", () => {
      const result = summarizeToolResult({ output: "done", count: 5 })
      expect(result.type).toBe("object")
      expect(result.keys).toEqual(["output", "count"])
    })

    it("summarizes Buffer / Uint8Array", () => {
      const buf = Buffer.from([0x01, 0x02, 0x03, 0x04])
      const result = summarizeToolResult(buf)
      expect(result.type).toBe("binary")
      expect(result.bytes).toBe(4)
    })
  })

  describe("summarizePayload", () => {
    it("summarizes array payload", () => {
      const payload = [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }]
      const result = summarizePayload(payload)
      expect(result.type).toBe("array")
    })

    it("summarizes object payload", () => {
      const payload = { model: "gpt-5.1", messages: [] }
      const result = summarizePayload(payload)
      expect(result.type).toBe("object")
      expect(result.keys).toEqual(["model", "messages"])
    })

    it("summarizes string payload", () => {
      const result = summarizePayload("a\nb\nc\nd")
      expect(result.type).toBe("string")
      expect(result.lines).toBe(4)
    })
  })
})
