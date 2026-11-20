/**
 * The daemon-client domain's public entry (#1589): the client of the local daemon's protocol that
 * the host's commands, the MCP server and the helpers use. Another domain imports from here, never
 * a file inside.
 */

export { type RemoteTarget, runOnLocalDaemon } from "./cli.ts";
export { type CliResult, failure, isLoopbackHost, json, plain, said } from "./cli-view.ts";
export { DaemonClient, DaemonRefusal, daemonUrl } from "./client.ts";
export { resolveProject } from "./project-ref.ts";
export { resolveSession } from "./session-ref.ts";
