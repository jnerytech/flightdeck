/** A local stdio MCP server for the tests: one tool (`eco`) and one resource (`nota`). */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "eco", version: "1.0.0" });
server.registerTool(
  "eco",
  { description: "devolve o texto", inputSchema: { texto: z.string() } },
  async ({ texto }) => ({
    content: [{ type: "text", text: texto }],
  }),
);
server.registerResource("nota", "nota://teste", { description: "uma nota" }, async () => ({
  contents: [{ uri: "nota://teste", text: "oi" }],
}));
await server.connect(new StdioServerTransport());
