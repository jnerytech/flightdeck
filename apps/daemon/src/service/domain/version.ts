import { join } from "node:path";

/** Where `update` installs the daemon: `~/.flightdeck/bin/flightdeckd(.exe)`. */
export function stableBinPath(home: string, platform: string): string {
  return join(home, ".flightdeck", "bin", platform === "win32" ? "flightdeckd.exe" : "flightdeckd");
}

/** Compares `x.y.z` numerically. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
