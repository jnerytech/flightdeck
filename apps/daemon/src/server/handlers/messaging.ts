/**
 * Issue #248: the messaging domain: messages between sessions, teams, and the messaging settings.
 */
import type { Handlers } from "../dispatch.ts";

export const messagingHandlers = {
  "teams.list": (payload, { server }) => {
    return { teams: server.needIn("messaging", "teams").list(payload.projectId) };
  },
  "teams.create": async (payload, { server }) => {
    return await server.needIn("messaging", "teams").create(payload);
  },
  "teams.update": async (payload, { server }) => {
    return await server.needIn("messaging", "teams").update(payload);
  },
  "teams.pause": (payload, { server }) => {
    return server.needIn("messaging", "teams").pause(payload.team);
  },
  "teams.resume": (payload, { server }) => {
    return server.needIn("messaging", "teams").resume(payload.team);
  },
  "teams.close": (payload, { server }) => {
    return server.needIn("messaging", "teams").close(payload.team, payload.confirm === true);
  },
  "teams.delete": (payload, { server }) => {
    return server.needIn("messaging", "teams").delete(payload.team);
  },
  "teams.message": (payload, { server }) => {
    return server.needIn("messaging", "teams").message(payload.team, payload.text);
  },
  "teams.status": (payload, { server }) => {
    const { team, as } = payload;
    const asker = as ? server.needIn("messaging", "messages").whoIs(as).id : undefined;
    return server.needIn("messaging", "teams").status(team, asker);
  },
  // #1220: the asking session is the host's, resolved from `as`; the service checks its role.
  "teams.report": (payload, { server }) => {
    const asker = server.needIn("messaging", "messages").whoIs(payload.as).id;
    return server
      .needIn("messaging", "teams")
      .report(payload.team, asker, payload.text, payload.done);
  },
  "teams.watch": (_payload, { ws, send, server }) => {
    const service = server.needIn("messaging", "teams");
    ws.data.unwatchTeams?.();
    ws.data.unwatchTeams = service.watch((frame) => send(frame));
  },
  "messages.send": (payload, { server }) => {
    return server.needIn("messaging", "messages").send(payload);
  },
  "messages.list": (payload, { server }) => {
    return { messages: server.needIn("messaging", "messages").list(payload) };
  },
  "messages.sessions": (payload, { server }) => {
    return { sessions: server.needIn("messaging", "messages").sessions(payload.as) };
  },
  "messages.read": async (payload, { server }) => {
    const { as, session, last } = payload;
    return await server.needIn("messaging", "messages").read(as, session, last);
  },
  "messages.relay": (payload, { server }) => {
    return server.needIn("messaging", "messages").relay(payload.message);
  },
  "messages.relayed": (payload, { server }) => {
    const { id, ...result } = payload;
    server.needIn("messaging", "messages").relayed(id, result);
  },
  "messages.directory": (_payload, { server }) => {
    return {
      host: server.opts.hostName,
      sessions: server.needIn("messaging", "messages").directory(),
    };
  },
  "messages.peers": (payload, { server }) => {
    server.needIn("messaging", "messages").setPeers(payload.host, payload.sessions);
  },
  "messages.watch": (_payload, { ws, send, server }) => {
    const service = server.needIn("messaging", "messages");
    const watched = server.needIn("messaging", "idle");
    ws.data.unwatchMessages?.();
    const stopMessages = service.watch((frame) => send(frame));
    const stopIdle = watched.watch((frame) => send(frame));
    ws.data.unwatchMessages = () => {
      stopMessages();
      stopIdle();
    };
  },
  "messaging.rules.get": (_payload, { server }) => {
    const messages = server.needIn("messaging", "messages");
    return {
      policy: messages.getPolicy() as unknown as Record<string, unknown>,
      paused: messages.pausedPairs(),
    };
  },
  "messaging.rules.set": (payload, { server }) => {
    const { policy, unpause } = payload;
    const set = server.needIn("messaging", "messages").setPolicy(policy, unpause);
    return {
      policy: set.policy as unknown as Record<string, unknown>,
      paused: set.paused,
    };
  },
} satisfies Partial<Handlers>;
