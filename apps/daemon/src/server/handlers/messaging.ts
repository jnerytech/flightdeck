/**
 * Issue #248: the messaging domain: messages between sessions, teams, and the messaging settings.
 */
import type { Handlers } from "../dispatch.ts";

export const messagingHandlers = {
  "teams.list": (payload, { server }) => {
    return { teams: server.need("teams").list(payload.projectId) };
  },
  "teams.create": async (payload, { server }) => {
    return await server.need("teams").create(payload);
  },
  "teams.update": async (payload, { server }) => {
    return await server.need("teams").update(payload);
  },
  "teams.pause": (payload, { server }) => {
    return server.need("teams").pause(payload.team);
  },
  "teams.resume": (payload, { server }) => {
    return server.need("teams").resume(payload.team);
  },
  "teams.close": (payload, { server }) => {
    return server.need("teams").close(payload.team, payload.confirm === true);
  },
  "teams.message": (payload, { server }) => {
    return server.need("teams").message(payload.team, payload.text);
  },
  "teams.status": (payload, { server }) => {
    const { team, as } = payload;
    const asker = as ? server.need("messaging").whoIs(as).id : undefined;
    return server.need("teams").status(team, asker);
  },
  "teams.watch": (_payload, { ws, send, server }) => {
    const service = server.need("teams");
    ws.data.unwatchTeams?.();
    ws.data.unwatchTeams = service.watch((frame) => send(frame));
  },
  "messages.send": (payload, { server }) => {
    return server.need("messaging").send(payload);
  },
  "messages.list": (payload, { server }) => {
    return { messages: server.need("messaging").list(payload) };
  },
  "messages.sessions": (payload, { server }) => {
    return { sessions: server.need("messaging").sessions(payload.as) };
  },
  "messages.read": async (payload, { server }) => {
    const { as, session, last } = payload;
    return await server.need("messaging").read(as, session, last);
  },
  "messages.relay": (payload, { server }) => {
    return server.need("messaging").relay(payload.message);
  },
  "messages.relayed": (payload, { server }) => {
    const { id, ...result } = payload;
    server.need("messaging").relayed(id, result);
  },
  "messages.directory": (_payload, { server }) => {
    return { host: server.opts.hostName, sessions: server.need("messaging").directory() };
  },
  "messages.peers": (payload, { server }) => {
    server.need("messaging").setPeers(payload.host, payload.sessions);
  },
  "messages.watch": (_payload, { ws, send, server }) => {
    const service = server.need("messaging");
    const watched = server.need("idle");
    ws.data.unwatchMessages?.();
    const stopMessages = service.watch((frame) => send(frame));
    const stopIdle = watched.watch((frame) => send(frame));
    ws.data.unwatchMessages = () => {
      stopMessages();
      stopIdle();
    };
  },
  "messaging.rules.get": (_payload, { server }) => {
    return {
      policy: server.need("messaging").getPolicy() as unknown as Record<string, unknown>,
      paused: server.need("messaging").pausedPairs(),
    };
  },
  "messaging.rules.set": (payload, { server }) => {
    const { policy, unpause } = payload;
    const set = server.need("messaging").setPolicy(policy, unpause);
    return {
      policy: set.policy as unknown as Record<string, unknown>,
      paused: set.paused,
    };
  },
} satisfies Partial<Handlers>;
