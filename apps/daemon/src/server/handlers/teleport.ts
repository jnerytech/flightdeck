/**
 * Issue #1288: the teleport domain: moving a session's package to another host (issue #100). The
 * sending host prepares, reads and cancels a package; the receiving one takes the manifest, the
 * parts, then finishes the import or aborts.
 */
import { importPackage } from "../../teleport/import.ts";
import type { Handlers } from "../dispatch.ts";

export const teleportHandlers = {
  "teleport.prepare": async (payload, { server }) => {
    return await server.needIn("teleport", "packages").prepare(payload.sessionId);
  },
  "teleport.read": async (payload, { server }) => {
    const { id, part, offset } = payload;
    return await server.needIn("teleport", "packages").read(id, part, offset);
  },
  "teleport.cancel": async (payload, { server }) => {
    await server.needIn("teleport", "packages").cancel(payload.id);
    return undefined;
  },
  "teleport.receive": async (payload, { server }) => {
    return await server.needIn("teleport", "inbox").receive(payload.manifest);
  },
  "teleport.write": async (payload, { server }) => {
    const { id, part, offset, data } = payload;
    return await server.needIn("teleport", "inbox").write(id, part, offset, data);
  },
  "teleport.abort": async (payload, { server }) => {
    await server.needIn("teleport", "inbox").abort(payload.id);
    return undefined;
  },
  "teleport.finish": async (payload, { server }) => {
    const deps = server.needIn("teleport", "imports");
    const { id, repo } = payload;
    return await importPackage(deps, id, repo);
  },
} satisfies Partial<Handlers>;
