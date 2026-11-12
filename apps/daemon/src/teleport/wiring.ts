import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { type DomainModule, serverGroup } from "../server/index.ts";
import { type TeleportImportWiring, teleportImportDeps } from "./import.ts";
import { TeleportPackages, type TeleportWiring, teleportDeps } from "./package.ts";
import { TeleportInbox } from "./receive.ts";

/** What the daemon's teleport is built from (issue #1593). */
type TeleportParts = Omit<TeleportWiring, "historyRoots" | "dataDir" | "manager"> & {
  config: {
    dataDir: string;
    history: { roots: readonly string[] };
    /** The daemon's own array: `roots.add` pushes into it, so an import sees a new root at once. */
    allowedRoots: readonly string[];
  };
  manager: TeleportWiring["manager"] & TeleportImportWiring["manager"];
  /** The sessions' meta, made later than the teleport: read only when an import runs. */
  meta: TeleportImportWiring["meta"];
};

/**
 * Issue #100: the packages of the sessions this host teleports to another, and the packages other
 * hosts send to this one (slice 2a); none outlives a run. Its module (issue #2094) starts both,
 * serves the `teleport` group and stops both after the server.
 */
export function createTeleport({ config, meta, ...parts }: TeleportParts) {
  const teleport = new TeleportPackages(
    teleportDeps({ ...parts, historyRoots: config.history.roots, dataDir: config.dataDir }),
  );
  const teleportInbox = new TeleportInbox({
    dir: join(config.dataDir, "teleport-in"),
    now: Date.now,
    newId: randomUUID,
    timers: globalThis,
  });
  const module: DomainModule<"teleport"> = {
    server: {
      teleport: serverGroup<"teleport", "imports">()({
        packages: teleport,
        inbox: teleportInbox,
        imports: teleportImportDeps({
          inbox: teleportInbox,
          allowedRoots: config.allowedRoots,
          historyRoots: config.history.roots,
          indexer: parts.indexer,
          manager: parts.manager,
          meta,
        }),
      }),
    },
    start: async () => {
      await teleport.start();
      await teleportInbox.start();
    },
    // Issue #100: no package of a transcript outlives the daemon.
    stop: async () => {
      await teleport.stop();
      await teleportInbox.stop();
    },
    stopPhase: "late",
  };
  return { modules: [module] as const, teleport, teleportInbox };
}
