import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { TeleportPackages, type TeleportWiring, teleportDeps } from "./package.ts";
import { TeleportInbox, type TeleportInboxDeps } from "./receive.ts";

/** What the daemon's teleport is built from (issue #1593). */
export type TeleportParts = Omit<TeleportWiring, "historyRoots" | "dataDir"> & {
  config: { dataDir: string; history: { roots: readonly string[] } };
};

/** The received packages' inbox as the daemon builds it: under the data dir, on the real clock. */
export function teleportInboxDeps(dataDir: string): TeleportInboxDeps {
  return {
    dir: join(dataDir, "teleport-in"),
    now: Date.now,
    newId: randomUUID,
    timers: globalThis,
  };
}

/**
 * Issue #100: the packages of the sessions this host teleports to another, and the packages other
 * hosts send to this one (slice 2a); none outlives a run. Both are left to the caller to start.
 */
export function createTeleport({ config, ...parts }: TeleportParts) {
  const teleport = new TeleportPackages(
    teleportDeps({ ...parts, historyRoots: config.history.roots, dataDir: config.dataDir }),
  );
  const teleportInbox = new TeleportInbox(teleportInboxDeps(config.dataDir));
  return { teleport, teleportInbox };
}
