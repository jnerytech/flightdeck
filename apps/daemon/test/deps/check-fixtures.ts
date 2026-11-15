import type { DepResult } from "@flightdeck/protocol";
import type { DepsEnv } from "../../src/deps/domain/deps.ts";

export const TOOLS: Record<string, { path: string; version: string }> = {
  claude: { path: "/usr/bin/claude", version: "2.1.0" },
  git: { path: "/usr/bin/git", version: "2.43.0" },
  gh: { path: "/usr/bin/gh", version: "2.60.0" },
  az: { path: "/usr/bin/az", version: "2.65.0" },
  ssh: { path: "/usr/bin/ssh", version: "9.6" },
  tailscale: { path: "/usr/bin/tailscale", version: "1.76.0" },
  systemctl: { path: "/usr/bin/systemctl", version: "255" },
  schtasks: { path: "C:/Windows/System32/schtasks.exe", version: "10.0" },
  pwsh: { path: "C:/Program Files/PowerShell/7/pwsh.exe", version: "7.4.0" },
};

/** A machine with everything in place, with `change` applied on top. */
export function machine(
  change: Partial<DepsEnv> & { without?: string[]; versions?: Record<string, string> } = {},
) {
  const { without = [], versions = {}, ...rest } = change;
  const env: DepsEnv = {
    platform: "linux",
    which: (name) => (without.includes(name) ? null : (TOOLS[name]?.path ?? null)),
    version: async (path) => {
      const name = Object.keys(TOOLS).find((n) => TOOLS[n]?.path === path) ?? "";
      return versions[name] ?? TOOLS[name]?.version ?? null;
    },
    allowedRoots: ["/home/dev/code"],
    serviceInstalled: async () => true,
    linger: async () => "on",
    hooks: async () => "installed",
    account: async () => "signed_in",
    ...rest,
  };
  return env;
}

export const find = (items: DepResult[], id: string) =>
  items.find((item) => item.id === id) as DepResult;
