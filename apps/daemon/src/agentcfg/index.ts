/**
 * The agent configuration's public entry (#1589): the agent and MCP editors of a project and of the
 * host. Another domain imports from here, never a file inside.
 */
export { frontmatter } from "./domain/frontmatter.ts";
export { AgentConfig, claudeMds } from "./files.ts";
export { McpConfig } from "./mcp.ts";
