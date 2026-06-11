import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createRedactExtension } from "../../../src/executors/pi/extensions/redact-extension.js"

vi.mock("@secretlint/core", () => ({
  lintSource: vi.fn()
}))

import { lintSource } from "@secretlint/core"

function makeTextBlock(text: string) {
  return { type: "text" as const, text }
}

function makeImageBlock() {
  return { type: "image" as const, data: "base64...", mimeType: "image/png" }
}

function makeToolResultEvent(content: Array<{ type: string; text?: string }>) {
  return {
    type: "tool_result" as const,
    toolCallId: "call-1",
    toolName: "bash",
    input: { command: "cat .env" },
    content: content as any,
    isError: false,
    details: undefined
  }
}

describe("createRedactExtension", () => {
  let handler: Function
  let mockPi: { on: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    handler = () => {}
    mockPi = {
      on: vi.fn((_event: string, h: Function) => { handler = h })
    }
    vi.clearAllMocks()
  })

  it("registers a tool_result listener", () => {
    const factory = createRedactExtension()
    factory(mockPi as any)
    expect(mockPi.on).toHaveBeenCalledWith("tool_result", expect.any(Function))
  })

  it("returns undefined when no secrets are found", async () => {
    vi.mocked(lintSource).mockResolvedValue({ messages: [], filePath: "", sourceContent: "", sourceContentType: "text" } as any)

    const factory = createRedactExtension()
    factory(mockPi as any)

    const event = makeToolResultEvent([makeTextBlock("hello world this is safe text with enough length")])
    const result = await handler(event)

    expect(result).toBeUndefined()
  })

  it("redacts a single secret with [REDACTED:Type] placeholder", async () => {
    vi.mocked(lintSource).mockResolvedValue({
      messages: [
        {
          message: "GitHub Token found",
          messageId: "GitHubToken",
          range: [9, 49] as [number, number],
          severity: "error"
        }
      ],
      filePath: "",
      sourceContent: "",
      sourceContentType: "text"
    } as any)

    const factory = createRedactExtension()
    factory(mockPi as any)

    const text = "GH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890"
    const event = makeToolResultEvent([makeTextBlock(text)])
    const result = await handler(event)

    expect(result).toBeDefined()
    expect((result as any).content[0].text).toBe("GH_TOKEN=[REDACTED:GitHubToken]")
  })

  it("redacts multiple secrets preserving right-to-left offset order", async () => {
    vi.mocked(lintSource).mockResolvedValue({
      messages: [
        {
          message: "AWS Key found",
          messageId: "AWSAccessKeyID",
          range: [0, 20] as [number, number],
          severity: "error"
        },
        {
          message: "GitHub Token found",
          messageId: "GitHubToken",
          range: [21, 61] as [number, number],
          severity: "error"
        }
      ],
      filePath: "",
      sourceContent: "",
      sourceContentType: "text"
    } as any)

    const factory = createRedactExtension()
    factory(mockPi as any)

    const text = "AKIAIOSFODNN7EXAMPLE\nghp_abcdefghijklmnopqrstuvwxyz1234567890"
    const event = makeToolResultEvent([makeTextBlock(text)])
    const result = await handler(event)

    expect((result as any).content[0].text).toBe("[REDACTED:AWSAccessKeyID]\n[REDACTED:GitHubToken]")
  })

  it("passes output through unredacted when lintSource throws", async () => {
    vi.mocked(lintSource).mockRejectedValue(new Error("secretlint internal error"))

    const factory = createRedactExtension()
    factory(mockPi as any)

    const text = "some text with a fake secret that crashes the linter to trigger error path"
    const event = makeToolResultEvent([makeTextBlock(text)])
    const result = await handler(event)

    expect(result).toBeUndefined()
  })

  describe("timeout", () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it("passes output through unredacted when lintSource exceeds 2s", async () => {
      vi.mocked(lintSource).mockImplementation(() => new Promise(() => {}))

      const factory = createRedactExtension()
      factory(mockPi as any)

      const text = "some text with enough characters to pass the minimum length check"
      const event = makeToolResultEvent([makeTextBlock(text)])
      const resultPromise = handler(event)

      vi.advanceTimersByTime(2100)
      const result = await resultPromise

      expect(result).toBeUndefined()
    })
  })

  it("skips text shorter than 20 characters", async () => {
    const factory = createRedactExtension()
    factory(mockPi as any)

    const event = makeToolResultEvent([makeTextBlock("short")])
    const result = await handler(event)

    expect(result).toBeUndefined()
    expect(lintSource).not.toHaveBeenCalled()
  })

  it("passes image blocks through untouched", async () => {
    vi.mocked(lintSource).mockResolvedValue({ messages: [], filePath: "", sourceContent: "", sourceContentType: "text" } as any)

    const factory = createRedactExtension()
    factory(mockPi as any)

    const event = makeToolResultEvent([makeImageBlock()])
    const result = await handler(event)

    expect(result).toBeUndefined()
    expect(lintSource).not.toHaveBeenCalled()
  })

  it("scans text blocks while leaving image blocks unchanged in mixed content", async () => {
    vi.mocked(lintSource).mockResolvedValue({ messages: [], filePath: "", sourceContent: "", sourceContentType: "text" } as any)

    const factory = createRedactExtension()
    factory(mockPi as any)

    const event = makeToolResultEvent([
      makeImageBlock(),
      makeTextBlock("hello world this is safe text with enough length"),
      makeImageBlock()
    ])
    const result = await handler(event)

    expect(result).toBeUndefined()
    expect(lintSource).toHaveBeenCalledTimes(1)
  })

  it("redacts text in one block while leaving other blocks unchanged", async () => {
    vi.mocked(lintSource).mockImplementation((opts: any) => {
      const secretText = "github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
      if ((opts.source.content as string).includes(secretText)) {
        return Promise.resolve({
          messages: [
            {
              message: "GitHub Token found",
              messageId: "GitHubToken",
              range: [0, secretText.length] as [number, number],
              severity: "error"
            }
          ],
          filePath: "",
          sourceContent: "",
          sourceContentType: "text"
        } as any)
      }
      return Promise.resolve({ messages: [], filePath: "", sourceContent: "", sourceContentType: "text" } as any)
    })

    const factory = createRedactExtension()
    factory(mockPi as any)

    const secretText = "github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"
    const safeText = "this is normal output with enough length to be scanned"
    const event = makeToolResultEvent([
      makeTextBlock(safeText),
      makeTextBlock(secretText)
    ])
    const result = await handler(event)

    expect((result as any).content[0].text).toBe(safeText)
    expect((result as any).content[1].text).toBe("[REDACTED:GitHubToken]")
  })
})
