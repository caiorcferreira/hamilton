# MCP Server

> ⚠️ **Autonomous mode (experimental).** This documents Hamilton's workflow engine, which is under active rework and can change without notice. See [The three modes](./modes.md). For the working path today, use [Assisted mode](./skills.md).

Hamilton can expose its capabilities via the Model Context Protocol.

```bash
hamilton mcp
```

This starts an MCP server that external tools and AI assistants can use to:
- List available workflows
- Run workflows
- Query run status
- Retrieve logs

The MCP server uses `@modelcontextprotocol/sdk` 1.12.0. It's designed for integration
with MCP-compatible tools like Claude Desktop and other AI assistants.
