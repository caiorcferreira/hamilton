# MCP Server

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
