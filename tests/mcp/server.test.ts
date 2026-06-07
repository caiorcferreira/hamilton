import { describe, it, expect } from "vitest"
import { createMcpServer } from "../../src/mcp/server.js"

describe("createMcpServer", () => {
  it("creates an MCP server instance", () => {
    const server = createMcpServer()
    expect(server).toBeDefined()
  })
})