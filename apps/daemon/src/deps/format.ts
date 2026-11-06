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

/** The headline: what is missing among the required first, then the optional, else all set. */
function headlineOf(required: number, optional: number): string {
  if (required > 0) return `${required} required missing`;
  return optional > 0 ? `${optional} optional missing` : "all set";
}

/** One dependency's lines: its state, then (when lacking) what breaks and the fix for `os`. */
function itemLines(item: DepResult, os: string): string[] {
  const found = [item.version, item.path].filter(Boolean).join("  ");
  const lines = [`    ${TAG[item.state].padEnd(9)}${item.id.padEnd(11)}${found}`.trimEnd()];
  if (!lacking(item)) return lines;
  if (item.breaks.length > 0) {
    lines.push(`             without it: ${item.breaks.map((b) => BREAKS[b]).join(", ")}`);
  }
  const fix = item.fix.find((f) => f.os === os);
  if (fix?.command) lines.push(`             -> ${fix.command}`);
  if (fix?.url) lines.push(`             page: ${fix.url}`);
  return lines;
}

/** A group's title and its items; nothing when the group is empty. */
function groupLines(items: DepResult[], title: string, os: string): string[] {
  if (items.length === 0) return [];
  return [`  ${title}`, ...items.flatMap((item) => itemLines(item, os))];
}

/** The dependencies as the lines `flightdeckd doctor` prints: the headline, then Required and Optional. */
export function formatDeps(deps: DepsResult, os: string): string[] {
  const count = (group: DepResult["group"]) =>
    deps.items.filter((item) => item.group === group && lacking(item)).length;
  const required = count("required");
  const optional = count("optional");
  return [
    `Dependencies: ${headlineOf(required, optional)}`,
    ...groupLines(
      deps.items.filter((item) => item.group === "required"),
      "Required",
      os,
    ),
    ...groupLines(
      deps.items.filter((item) => item.group === "optional"),
      "Optional",
      os,
    ),
  ];
}

/** The exit code of `flightdeckd doctor`: 1 when its checks failed or a required dependency is lacking. */
export function doctorExitCode(checksOk: boolean, deps: DepsResult): number {
  const lackingRequired = deps.items.some((item) => item.group === "required" && lacking(item));
  return checksOk && !lackingRequired ? 0 : 1;
}
