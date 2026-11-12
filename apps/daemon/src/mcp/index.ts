/**
 * The MCP domain's public entry (#1589): the Flightdeck MCP server a Claude Code session runs, its
 * tools over the local daemon, and whether its program is still there. Another domain imports from
 * here, never a file inside.
 */
export { identityOf, mcpReachable, runnableActions, startMcp } from "./server.ts";
