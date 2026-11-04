import type { DepFeature, DepResult, DepsResult } from "@flightdeck/protocol";

/** What stops working without each dependency, in the words the terminal prints (the app has its own, translated). */
const BREAKS: Record<DepFeature, string> = {
  sessions: "sessions cannot start or resume",
  projects: "projects",
  worktrees: "card worktrees and branches",
  changes: "the Changes view",
  board: "board cards",
  autostart: "the daemon does not start by itself after a reboot",
  github: "GitHub sign-in",
  pullRequests: "pull requests from a card",
  boardSync: "board sync with GitHub Projects",
  azure: "Azure DevOps boards and pull requests",
  remoteHosts: "remote hosts",
  teleport: "host teleport",
  pairing: "pairing from other networks",
  windowsSetup: "the Windows setup helpers",
  liveStatus: "live session status",
};

const TAG: Record<DepResult["state"], string> = {
  ok: "OK",
  outdated: "OUTDATED",
  missing: "MISSING",
  na: "N/A",
};

const lacking = (item: DepResult) => item.state === "missing" || item.state === "outdated";

/** The dependencies as the lines `flightdeckd doctor` prints: the headline, then Required and Optional. */
export function formatDeps(deps: DepsResult, os: string): string[] {
  const count = (group: DepResult["group"]) =>
    deps.items.filter((item) => item.group === group && lacking(item)).length;
  const required = count("required");
  const optional = count("optional");
  const headline =
    required > 0
      ? `${required} required missing`
      : optional > 0
        ? `${optional} optional missing`
        : "all set";
  const lines = [`Dependencies: ${headline}`];
  for (const [group, title] of [
    ["required", "Required"],
    ["optional", "Optional"],
  ] as const) {
    const items = deps.items.filter((item) => item.group === group);
    if (items.length === 0) continue;
    lines.push(`  ${title}`);
    for (const item of items) {
      const found = [item.version, item.path].filter(Boolean).join("  ");
      lines.push(`    ${TAG[item.state].padEnd(9)}${item.id.padEnd(11)}${found}`.trimEnd());
      if (!lacking(item)) continue;
      if (item.breaks.length > 0) {
        lines.push(`             without it: ${item.breaks.map((b) => BREAKS[b]).join(", ")}`);
      }
      const fix = item.fix.find((f) => f.os === os);
      if (fix?.command) lines.push(`             -> ${fix.command}`);
      if (fix?.url) lines.push(`             page: ${fix.url}`);
    }
  }
  return lines;
}
