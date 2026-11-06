/**
 * Issue #248: the review domain: review comments and changed files, snapshots and rewind, the
 * trace, and the history index.
 */
import { withTurnUuids } from "../../checkpoints/turn-uuid.ts";
import { FlightdeckError, featureOff } from "../../errors.ts";
import { preparePersonas } from "../../personas/prepare.ts";
import type { Handlers } from "../dispatch.ts";

export const reviewHandlers = {
  "snapshots.list": (payload, { server }) => {
    return {
      // A terminal turn's uuid is found in the indexed transcript, when it can be told.
      snapshots: withTurnUuids(
        server.opts.snapshots?.list(payload.claudeSessionId) ?? [],
        server.opts.history?.userPrompts(payload.claudeSessionId) ?? [],
      ),
    };
  },
  "snapshots.files": async (payload, { server }) => {
    if (!server.opts.snapshots) throw featureOff("snapshots");
    const { claudeSessionId, n } = payload;
    return await server.opts.snapshots.files(claudeSessionId, n);
  },
  "rewind.preview": async (payload, { server }) => {
    const { claudeSessionId, turn } = payload;
    return await server.need("rewinder").preview(claudeSessionId, turn);
  },
  "rewind.apply": async (payload, { server }) => {
    const { claudeSessionId, turn, confirm } = payload;
    return await server.need("rewinder").apply(claudeSessionId, turn, confirm === true);
  },
  "rewind.undo": async (payload, { server }) => {
    const { claudeSessionId, confirm } = payload;
    return await server.need("rewinder").undo(claudeSessionId, confirm === true);
  },
  "history.get": async (payload, { server }) => {
    const { claudeSessionId, cursor, limit, tail } = payload;
    return await server.need("history").get(claudeSessionId, cursor, limit, tail);
  },
  "history.search": (payload, { server }) => {
    const index = server.need("history");
    const hits = index.search(payload).map((hit) => ({
      ...hit,
      cursor: index.cursorFor(hit.claudeSessionId, hit.uuid),
    }));
    return { hits };
  },
  "history.resume": async (payload, { server }) => {
    const { claudeSessionId, force, name, permissionMode } = payload;
    const session = server.need("history").session(claudeSessionId);
    if (!session) {
      throw new FlightdeckError(
        "not_found",
        `transcript ${claudeSessionId} not indexed`,
        "transcript_not_indexed",
        { id: claudeSessionId },
      );
    }
    if (session.maybeActive && !force) {
      throw new FlightdeckError(
        "invalid_state",
        "session possibly in use elsewhere; send force: true to resume anyway",
        "session_maybe_active",
      );
    }
    const { agents } = await preparePersonas(server.opts.personas, undefined, session.cwd);
    return await server.manager.createResumed({
      cwd: session.cwd,
      claudeSessionId,
      agents,
      name: name ?? session.title,
      ...(permissionMode ? { permissionMode } : {}),
    });
  },
  "history.watch": (_payload, { ws, send, server }) => {
    const index = server.need("history");
    ws.data.unwatchHistory?.();
    ws.data.unwatchHistory = index.onChange((change) =>
      send({ type: "history.changed", ...change }),
    );
  },
  "trace.get": async (payload, { server }) => {
    return await server.need("trace").get(payload.claudeSessionId);
  },
  "trace.export": async (payload, { server }) => {
    const { claudeSessionId, includeContent } = payload;
    return await server.need("trace").export(claudeSessionId, includeContent === true);
  },
  "changes.get": async (payload, { server }) => {
    return await server.need("changes").get(payload.target);
  },
  "changes.watch": async (payload, { ws, send, server }) => {
    const { target } = payload;
    const stop = await server
      .need("changes")
      .watch(target, (result) => send({ type: "changes.updated", ...result }));
    ws.data.changeWatchers.get(target)?.();
    ws.data.changeWatchers.set(target, stop);
  },
  "changes.unwatch": (payload, { ws }) => {
    ws.data.changeWatchers.get(payload.target)?.();
    ws.data.changeWatchers.delete(payload.target);
  },
  "review.list": async (payload, { server }) => {
    return { comments: await server.need("review").list(payload.target) };
  },
  "review.add": async (payload, { server }) => {
    return await server.need("review").add(payload);
  },
  "review.update": async (payload, { server }) => {
    return await server.need("review").update(payload.id, payload.body);
  },
  "review.remove": (payload, { server }) => {
    server.need("review").remove(payload.id);
  },
  "review.send": async (payload, { server }) => {
    return await server.need("review").send(payload.target);
  },
  "changes.revert": async (payload, { server }) => {
    const { target, path, confirm } = payload;
    return await server.need("files").revert(target, path, confirm === true);
  },
  "changes.undoRevert": async (payload, { server }) => {
    const { target, path, confirm } = payload;
    return await server.need("files").undoRevert(target, path, confirm === true);
  },
} satisfies Partial<Handlers>;
