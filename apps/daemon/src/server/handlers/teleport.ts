/**
 * Issue #1288: the teleport domain: moving a session's package to another host (issue #100). The
 * sending host prepares, reads and cancels a package; the receiving one takes the manifest, the
 * parts, then finishes the import or aborts.
 */
import { importPackage } from "../../teleport/import.ts";
import type { Handlers } from "../dispatch.ts";

export const teleportHandlers = {
  "teleport.prepare": async (payload, { server }) => {
    return await server.need("teleport").prepare(payload.sessionId);
  },
  "teleport.read": async (payload, { server }) => {
    const { id, part, offset } = payload;
    return await server.need("teleport").read(id, part, offset);
  },
  "teleport.cancel": async (payload, { server }) => {
    await server.need("teleport").cancel(payload.id);
    return undefined;
  },
  "teleport.receive": async (payload, { server }) => {
    return await server.need("teleportInbox").receive(payload.manifest);
  },
  "teleport.write": async (payload, { server }) => {
    const { id, part, offset, data } = payload;
    return await server.need("teleportInbox").write(id, part, offset, data);
  },
  "teleport.abort": async (payload, { server }) => {
    await server.need("teleportInbox").abort(payload.id);
    return undefined;
  },
  "teleport.finish": async (payload, { server }) => {
    const deps = server.need("teleportImport");
    const { id, repo } = payload;
    return await importPackage(deps, id, repo);
  },
} satisfies Partial<Handlers>;
