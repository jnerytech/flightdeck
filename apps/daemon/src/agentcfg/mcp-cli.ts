/**
 * Issue #3616: `flightdeckd mcp list|status|test`, a project's MCP servers and the state they report in a
 * live session (the app's Agent setup screen). Every verb here only reads: `test` never sends `confirm`,
 * so the daemon answers with the command or URL that a test would run and starts nothing. Exit codes: 0 done,
 * 1 refused, 2 no daemon.
 */
import {
  type CliResult,
  failure,
  type RemoteTarget,
  resolveProject,
  runOnLocalDaemon,
  shown,
} from "../daemon-client/index.ts";
import {
  listLines,
  previewJson,
  previewLine,
  serverJson,
  statusJson,
  statusLines,
} from "./domain/mcp-cli-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

/** A project (its name or its id) and a server's name, or a session's id, by the action. */
export type McpCliArgs = { json?: boolean } & (
  | { action: "list"; project: string }
  | { action: "status"; session: string }
  | { action: "test"; project: string; server: string }
);

export function runMcpCli(
  args: McpCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-mcp",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    perform: async (daemon) => {
      if (args.action === "status") {
        const { servers } = await daemon.call("mcp.status", { sessionId: args.session });
        return shown(args.json, { servers: servers.map(statusJson) }, () => statusLines(servers));
      }
      const { projects } = await daemon.call("project.list", {});
      const chosen = resolveProject(projects, args.project);
      if ("refusal" in chosen) return chosen.refusal;
      const projectId = chosen.id;
      if (args.action === "list") {
        const { servers } = await daemon.call("mcp.list", { projectId });
        return shown(args.json, { servers: servers.map(serverJson) }, () => listLines(servers));
      }
      const tested = await daemon.call("mcp.test", { projectId, name: args.server });
      if (!("preview" in tested))
        return failure(1, "the daemon started the server: this command only reads");
      const { preview } = tested;
      return shown(args.json, { preview: previewJson(preview) }, () => [previewLine(preview)]);
    },
  });
}
