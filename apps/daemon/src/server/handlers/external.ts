/**
 * Issue #1288: the external domain: the Claude Code sessions this host did not start, which the
 * hub learns of through their hooks. Their list with each one's line and meta, the stream of their
 * changes and open permission requests, and a message to one opened with `flightdeckd claude`.
 */
import type { ExternalSession, ExternalStatus, SessionLine } from "@flightdeck/protocol";
import { messageExternal } from "../../central/index.ts";
import { FlightdeckError } from "../../kernel/index.ts";
import type { ServerContext } from "../context.ts";
import { afterAck, type Handlers } from "../dispatch.ts";

const EXTERNAL_LINE: Record<ExternalStatus, SessionLine["state"]> = {
  running: "running",
  awaiting_permission: "waiting",
  idle: "idle",
  unknown: "idle",
  ended: "ended",
};

/** An external session as the lists and `external.updated` send it: with its line and name. */
function externalListed(server: ServerContext, s: ExternalSession): ExternalSession {
  const { opts } = server;
  const waiting = opts.central?.permissions
    .open()
    .find((frame) => frame.claudeSessionId === s.claudeSessionId);
  const summary = server.line(s.claudeSessionId, {
    state: EXTERNAL_LINE[s.status],
    waitingTool: waiting?.toolName ?? null,
    since: s.lastEventAt,
  });
  const meta = opts.central?.meta.get(s.claudeSessionId);
  return { ...s, ...(summary ? { summary } : {}), ...(meta ? { meta } : {}) };
}

export const externalHandlers = {
  "external.message": (payload, { server }) => {
    const { claudeSessionId, text } = payload;
    const hub = server.need("central");
    if (!hub.external.get(claudeSessionId)) {
      throw new FlightdeckError(
        "not_found",
        `session ${claudeSessionId} does not exist`,
        "session_not_found",
        { id: claudeSessionId },
      );
    }
    if (!messageExternal(hub, claudeSessionId, text)) {
      throw new FlightdeckError(
        "invalid_state",
        "session has no channel: only sessions opened with flightdeckd claude receive messages",
        "external_no_channel",
      );
    }
    return undefined;
  },
  "external.list": (_payload, { server }) => {
    const { external, meta } = server.need("central");
    const sessions = external
      .list()
      .map((s) => ({ ...externalListed(server, s), meta: meta.get(s.claudeSessionId) }));
    return { sessions };
  },
  "external.watch": (_payload, { ws, send, server }) => {
    // Ack, then the live sessions and the open requests, then every change: no gap.
    const { external, permissions } = server.need("central");
    ws.data.unwatchExternal?.();
    const offSessions = external.onChange((session) =>
      send({ type: "external.updated", session: externalListed(server, session) }),
    );
    const offPermissions = permissions.watch((frame) => {
      send(frame);
      // The session's line names the tool it waits for, known only once the request opens.
      const session = external.get(frame.claudeSessionId);
      if (session) send({ type: "external.updated", session: externalListed(server, session) });
    });
    ws.data.unwatchExternal = () => {
      offSessions();
      offPermissions();
    };
    return afterAck(undefined, () => {
      for (const session of external.list()) {
        send({ type: "external.updated", session: externalListed(server, session) });
      }
      for (const frame of permissions.open()) send(frame);
    });
  },
} satisfies Partial<Handlers>;
