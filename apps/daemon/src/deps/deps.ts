import type { DepResult, DepsResult } from "@flightdeck/protocol";

/** What the dependency probes need of the machine; tests give fakes, the daemon gives the real ones. */
export interface DepsEnv {
  platform: NodeJS.Platform;
  /** Where `name` is on the PATH (never `Bun.which` without options), or null. */
  which(name: string): string | null;
  /** What `<path> --version` says, or null when it does not answer. */
  version(path: string): Promise<string | null>;
  allowedRoots: readonly string[];
  /** Whether the daemon runs as a service of this machine. */
  serviceInstalled(): Promise<boolean>;
  /** Whether the user's systemd survives logout (Linux); null where it does not apply. */
  linger(): Promise<"on" | "off" | null>;
  hooks(): Promise<"installed" | "absent" | "outdated">;
}

/** The host's dependencies, required and optional, each with what stops working without it. */
export async function checkDeps(_env: DepsEnv): Promise<DepsResult> {
  const items: DepResult[] = [];
  return { items };
}
