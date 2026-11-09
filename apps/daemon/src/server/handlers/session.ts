/**
 * Issue #1288: the session domain: the managed sessions (create, send, modes, sleep and resume,
 * the event stream), their permission answers, the summaries' stream, the meta the person gives a
 * session, its fork, summary, files and persona, and the transcript history list. The external
 * sessions (`external.*`) and the assistant (`assistant.*`) are separate.
 */
import type {
  SessionEventOf,
  SessionLine,
  SessionStatus,
  SessionSummary,
} from "@flightdeck/protocol";
import { userHome } from "../../config.ts";
import { coalesceDeltas } from "../../delta-coalescer.ts";
import { featureOff } from "../../errors.ts";
import type { HistoryIndexer } from "../../history/indexer.ts";
import type { LiveState } from "../../history/session-line.ts";
import { resolveAllowedCwd } from "../../paths.ts";
import { realPathOf, statKind } from "../../permissions/path-kind.ts";
import { rulePaths, ruleReadings } from "../../permissions/permission-updates.ts";
import { pathKinds, realPaths } from "../../permissions/rule-risk.ts";
import { preparePersonas } from "../../personas/prepare.ts";
import type { ServerContext } from "../context.ts";
import { afterAck, type Call, type Handlers } from "../dispatch.ts";

/** Phase 8: the state of a session's line, from its live status. */
const MANAGED_LINE: Record<SessionStatus, SessionLine["state"]> = {
  starting: "running",
  running: "running",
  awaiting_permission: "waiting",
  idle: "idle",
  ended: "ended",
  error: "ended",
};

const managedLive = (server: ServerContext, s: SessionSummary): LiveState => ({
  state: MANAGED_LINE[s.status],
  waitingTool: server.manager.pendingPermissions(s.id)[0]?.toolName ?? null,
  since: s.updatedAt,
});

/**
 * Phase 5: every session list carries its project group and meta (with the hub on). Phase 8:
 * and its line, with the transcript index on.
 */
function listed<T extends { cwd: string }>(
  server: ServerContext,
  session: T,
  claudeSessionId: string | null,
  live: LiveState,
): T {
  const hub = server.opts.central;
  const summary = server.line(claudeSessionId, live);
  return {
    ...session,
    ...(hub
      ? { projectKey: hub.projectKey(session.cwd), meta: hub.meta.get(claudeSessionId ?? "") }
      : {}),
    ...(summary ? { summary } : {}),
  };
}

/** The indexed folders whose project is `key`; with no way to ask, only a folder key matches. */
async function foldersOf(
  server: ServerContext,
  index: HistoryIndexer,
  key: string,
): Promise<string[]> {
  const { opts } = server;
  const keyOf =
    opts.projectKeyOf ?? ((cwd: string) => Promise.resolve(`host:${opts.hostName}:${cwd}`));
  const cwds = index.distinctCwds();
  const keys = await Promise.all(cwds.map((cwd) => keyOf(cwd)));
  return cwds.filter((_, i) => keys[i] === key);
}

/** The socket's stream of one session, replacing any earlier one; the replay comes back to send. */
function subscribe({ ws, send, server }: Call, sessionId: string, sinceSeq: number) {
  ws.data.subscriptions.get(sessionId)?.();
  // The text of a stream goes out a few frames at a time; every other event flushes it first.
  const coalescer = coalesceDeltas({
    deliver: (envelope) => send(envelope),
    backlog: () => ws.getBufferedAmount(),
  });
  ws.data.coalescers.add(coalescer);
  const sub = server.manager.subscribe(sessionId, sinceSeq, (envelope) => coalescer.push(envelope));
  ws.data.subscriptions.set(sessionId, () => {
    sub.unsubscribe();
    coalescer.stop();
    ws.data.coalescers.delete(coalescer);
  });
  return sub;
}

export const sessionHandlers = {
  "session.list": async (_payload, { server }) => {
    const sessions = server.manager.list();
    await server.warmKeys(sessions.map((s) => s.cwd));
    return {
      sessions: sessions.map((s) => listed(server, s, s.claudeSessionId, managedLive(server, s))),
    };
  },
  "session.interrupted": (_payload, { server }) => {
    return { sessions: server.manager.interrupted() };
  },
  "session.create": async (payload, { server }) => {
    const { opts, manager } = server;
    // Looked up in git before the session exists, so what names and lists it finds the
    // project already known; the wait is this request's own, the others are served meanwhile.
    if (opts.warmProjectKey) {
      const cwd = await resolveAllowedCwd(payload.cwd, opts.allowedRoots);
      await opts.warmProjectKey(cwd);
    }
    const prepared = await preparePersonas(opts.personas, payload.persona, payload.cwd);
    return await manager.create(payload, { prepared });
  },
  // Issue #1361: the person's own input into a card's session steps the check loop aside.
  "session.send": (payload, { server }) => {
    server.opts.board?.personTurnOfSession(payload.sessionId);
    return server.manager.send(payload.sessionId, payload.text, payload.images);
  },
  "session.interrupt": async (payload, { server }) => {
    server.opts.board?.personTurnOfSession(payload.sessionId);
    await server.manager.interrupt(payload.sessionId);
    return undefined;
  },
  "session.setMode": async (payload, { server }) => {
    await server.manager.setPermissionMode(payload.sessionId, payload.permissionMode);
    return undefined;
  },
  "session.setModel": async (payload, { server }) => {
    await server.manager.setModel(payload.sessionId, payload.model);
    return undefined;
  },
  "session.setEffort": async (payload, { server }) => {
    await server.manager.setEffort(payload.sessionId, payload.effort);
    return undefined;
  },
  "session.close": async (payload, { server }) => {
    await server.manager.close(payload.sessionId);
    return undefined;
  },
  "session.sleep": async (payload, { server }) => {
    return { result: await server.manager.sleep(payload.sessionId, { manual: true }) };
  },
  "session.resume": async (payload, { server }) => {
    await server.manager.resume(payload.sessionId);
    return undefined;
  },
  "session.subscribe": (payload, call) => {
    // Ack, replay and live registration happen in one synchronous step: no gap, no dupes.
    const sub = subscribe(call, payload.sessionId, payload.sinceSeq ?? 0);
    return afterAck({ session: sub.session, replayed: sub.replay.length }, () => {
      for (const envelope of sub.replay) call.send(envelope);
    });
  },
  "session.unsubscribe": (payload, { ws }) => {
    ws.data.subscriptions.get(payload.sessionId)?.();
    ws.data.subscriptions.delete(payload.sessionId);
    return undefined;
  },
  "permission.respond": async (payload, { server }) => {
    const { manager, opts } = server;
    const asked = manager.sessionOfRequest(payload.requestId);
    if (asked) opts.board?.personTurnOfSession(asked);
    // External requests (ids `ext-…`) are held hooks; anything else is a managed session's.
    const { requestId, decision, message, updatedPermissions, updatedInput, held } = payload;
    const external = opts.central?.permissions;
    // A rule that names a folder covers all it holds (#395): look its paths up first, only for
    // an allow of a request that is open (an unknown one is refused below anyway).
    // The file the request itself writes counts as one before it exists. A symlink on the way
    // makes a rule reach its real path too, so that is rated as well (#528).
    const { cwd, target } = external?.placeOf(requestId) ?? manager.permissionPlace(requestId);
    const updates = updatedPermissions ?? [];
    const home = userHome();
    const disk =
      decision === "allow" && cwd
        ? await Promise.all([
            pathKinds(rulePaths(updates), cwd, home, statKind, {
              ...(target === undefined ? {} : { target }),
            }),
            realPaths(ruleReadings(updates), cwd, home, realPathOf),
          ]).then(([kind, real]) => ({ kind, real }))
        : undefined;
    if (
      !external?.respond(requestId, decision, message, updatedPermissions, updatedInput, held, disk)
    ) {
      manager.respondPermission(payload, disk);
    }
    return undefined;
  },
  "session.meta.set": (payload, { server }) => {
    const { opts } = server;
    const { claudeSessionId, ...patch } = payload;
    const meta = server.need("central").meta.set(claudeSessionId, patch);
    // The name the user gives also renames the standard one; the old alias keeps working.
    const given = patch.name?.trim();
    if (given && opts.names) {
      const id =
        opts.manager.list().find((s) => s.claudeSessionId === claudeSessionId)?.id ??
        claudeSessionId;
      if (opts.names.get(id)) opts.names.rename(id, given);
    }
    return { claudeSessionId, ...meta };
  },
  "session.fork": async (payload, { server }) => {
    if (!server.opts.forker) throw featureOff("forker");
    return await server.opts.forker.fork(payload);
  },
  "history.list": async (payload, { server }) => {
    const { projectKey, ...filter } = payload;
    const index = server.need("history");
    const page = index.list(
      projectKey ? { ...filter, cwds: await foldersOf(server, index, projectKey) } : filter,
    );
    await server.warmKeys(page.sessions.map((s) => s.cwd));
    const sessions = page.sessions.map((s) =>
      listed(server, s, s.claudeSessionId, { state: "ended", since: s.lastTs }),
    );
    return { ...page, sessions };
  },
  "session.summary": async (payload, { server }) => {
    const { claudeSessionId, question, state } = payload;
    return await server.need("summary").get(claudeSessionId, { question, state });
  },
  "session.files": (payload, { server }) => {
    return { files: server.need("sessionFiles").list(payload.claudeSessionId) };
  },
  "session.applyPersona": async (payload, { server }) => {
    const { sessionId, claudeSessionId, persona } = payload;
    return await server.need("personaSessions").apply({ sessionId, claudeSessionId, persona });
  },
  "session.clearPersona": async (payload, { server }) => {
    return await server.need("personaSessions").clear(payload);
  },
  "sessions.watch": (payload, { ws, send, server }) => {
    // Same pattern as subscribe: ack, current summaries, then live ones, with no gap.
    ws.data.unwatch?.();
    const watch = server.manager.watchSummaries((envelope) => send(envelope));
    ws.data.unwatch = watch.unwatch;
    // #1191: asked to, the current summaries ride in the ack, one frame for them all.
    if (payload.snapshot === "ack") {
      return {
        summaries: watch.snapshot.map(
          (envelope) => envelope.event as SessionEventOf<"session.summary">,
        ),
      };
    }
    return afterAck(undefined, () => {
      for (const envelope of watch.snapshot) send(envelope);
    });
  },
} satisfies Partial<Handlers>;
