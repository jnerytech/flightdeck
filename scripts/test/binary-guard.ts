/**
 * Guard against tests touching the real installed daemon: `flightdeckd update` swaps
 * `~/.flightdeck/bin/flightdeckd(.exe)`, and only the fake home of the tests may see that.
 */
import { existsSync, statSync } from "node:fs";
import { stableBinPath } from "../../apps/daemon/src/update.ts";

export interface BinaryGuard {
  /** The stable binary and its `.old`/`.new` neighbours under the real home, as found. */
  snapshot: Record<string, string>;
}

const describe = (path: string) => {
  if (!existsSync(path)) return "ausente";
  const stat = statSync(path);
  return `${stat.size} bytes, ${stat.mtimeMs}`;
};

const watched = (realHome: string) => {
  const stable = stableBinPath(realHome, process.platform);
  return [stable, `${stable}.old`, `${stable}.new`];
};

export function installBinaryGuard(realHome: string): BinaryGuard {
  return { snapshot: Object.fromEntries(watched(realHome).map((p) => [p, describe(p)])) };
}

/** Throws when any of the watched files appeared, vanished or changed since the snapshot. */
export function assertBinaryUntouched(guard: BinaryGuard): void {
  const changed = Object.entries(guard.snapshot).filter(([path, was]) => describe(path) !== was);
  if (changed.length > 0) {
    throw new Error(`binário real do flightdeckd mexido: ${changed.map(([p]) => p).join(", ")}`);
  }
}
