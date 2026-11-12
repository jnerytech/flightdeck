/**
 * The plugin domain's public entry (#1589). It exports, for now, only how main.ts builds the
 * agent setup (plugins, agent config, MCP, memory, tasks, templates); the rest of the domain moves
 * behind this entry with the remaining deep imports. Another domain imports from here.
 */

export { createAgentSetup } from "./wiring.ts";
