/**
 * Phase 21: `flightdeckd message list|send|idle|read|team`, how the `flightdeck` mod
 * (which cannot open a WebSocket) and a terminal reach the messaging tools. Who is asking comes from
 * the environment of the Claude Code session (FLIGHTDECK_SESSION, or the launch id of a terminal).
 */
import type { SessionIdentity } from "@flightdeck/protocol";
import { DaemonClient, daemonUrl } from "../mcp.ts";
import { listSessions, notifyWhenIdle, readSession, sendToSession, teamStatus } from "./tools.ts";

export interface MessageCliArgs {
  action: "list" | "send" | "idle" | "read" | "team";
  to?: string;
  text?: string;
  session?: string;
  last?: number;
  team?: string;
}

/** The JSON to print. Errors of the daemon are thrown as `code: message`. */
export async function runMessageCli(
  args: MessageCliArgs,
  config: { bind: string; port: number; token: string },
  identity: SessionIdentity | undefined,
): Promise<unknown> {
  if (!identity) {
    throw new Error(
      "this session was not opened by Flightdeck, so I do not know who is sending: FLIGHTDECK_SESSION or FLIGHTDECK_LAUNCH_ID say which one it is",
    );
  }
  const daemon = await DaemonClient.connect(daemonUrl(config), config.token).catch(
    (error: Error) => {
      throw new Error(`could not connect to the daemon: ${error.message}`);
    },
  );
  try {
    switch (args.action) {
      case "list":
        return await listSessions(daemon, identity);
      case "send":
        return await sendToSession(daemon, identity, args.to as string, args.text as string);
      case "idle":
        return await notifyWhenIdle(daemon, identity, args.session as string);
      case "read":
        return await readSession(daemon, identity, args.session as string, args.last);
      case "team":
        return await teamStatus(daemon, identity, args.team as string);
    }
  } finally {
    daemon.close();
  }
}
