/**
 * The daemon-client domain's public entry (#1589): the client of the local daemon's protocol that
 * the host's commands, the MCP server and the helpers use. Another domain imports from here, never
 * a file inside.
 */
export { DaemonClient, DaemonUnreachable, daemonUrl } from "./client.ts";
