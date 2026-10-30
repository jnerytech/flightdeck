/**
 * Phase 17: `flightdeckd action list|run`, how the `flightdeck-actions` mod (which cannot open a
 * WebSocket) and a terminal reach the actions of the local daemon. It speaks the protocol as
 * Claude would: a run is asked of the app like any other, and what is printed is the same JSON the
 * MCP tools answer, with the secrets masked.
 */
import { DaemonClient, daemonUrl, runnableActions } from "../mcp.ts";

export interface ActionCliArgs {
  action: "list" | "run";
  project?: string | undefined;
  name?: string | undefined;
  params?: Record<string, string> | undefined;
}

/** The JSON to print. Errors of the daemon are thrown as `code: message`. */
export async function runActionCli(
  args: ActionCliArgs,
  config: { bind: string; port: number; token: string },
): Promise<unknown> {
  const daemon = await DaemonClient.connect(daemonUrl(config), config.token).catch(
    (error: Error) => {
      throw new Error(`não consegui conectar no daemon: ${error.message}`);
    },
  );
  try {
    const project = args.project ? { projectId: args.project } : {};
    if (args.action === "list") {
      const { actions } = await daemon.call("actions.list", project);
      return { actions: runnableActions(actions) };
    }
    return await daemon.call("actions.run", {
      ...project,
      name: args.name as string,
      requestedBy: "claude",
      ...(args.params ? { params: args.params } : {}),
    });
  } finally {
    daemon.close();
  }
}
