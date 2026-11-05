import { type DepResult, type DepsResult, safeFixCommand, safeFixUrl } from "@flightdeck/protocol";

/** The section's headline: everything in place, optional ones missing, or required ones missing. */
export interface DepsSummary {
  kind: "ok" | "optional" | "required";
  n: number;
}

/** How a row looks: its icon (never the color alone) and its tone. */
export type DepLook = {
  icon: "check" | "warning" | "cross" | "dash";
  tone: "ok" | "warn" | "error" | "off";
};

export function depsSummary(items: DepResult[]): DepsSummary {
  // Red is a required one missing; an outdated one (any group) and an optional one missing are amber.
  const missing = items.filter((item) => item.group === "required" && item.state === "missing");
  if (missing.length > 0) return { kind: "required", n: missing.length };
  const amber = items.filter(
    (item) => item.state === "outdated" || (item.group === "optional" && item.state === "missing"),
  );
  return amber.length > 0 ? { kind: "optional", n: amber.length } : { kind: "ok", n: 0 };
}

export function depLook(item: DepResult): DepLook {
  if (item.state === "ok") return { icon: "check", tone: "ok" };
  if (item.state === "na") return { icon: "dash", tone: "off" };
  // Outdated, or an optional one missing: it still works, or only a feature goes.
  if (item.state === "outdated" || item.group === "optional")
    return { icon: "warning", tone: "warn" };
  return { icon: "cross", tone: "error" };
}

/** The command that installs or upgrades the dependency on the host's own OS, or null. */
export function fixFor(item: DepResult, os: string): string | null {
  const command = item.fix.find((fix) => fix.os === os)?.command;
  // The host chooses this line and the person pastes it into a shell: only the known ones are shown.
  return command !== undefined && safeFixCommand(command) ? command : null;
}

/** The official install page for the dependency on the host's own OS, or null. */
export function fixPageFor(item: DepResult, os: string): string | null {
  const url = item.fix.find((fix) => fix.os === os)?.url;
  return url !== undefined && safeFixUrl(url) ? url : null;
}

/** Whether a required dependency of the host is missing (what the sidebar marks red); outdated is amber. */
export function requiredMissing(deps: DepsResult | undefined): boolean {
  return deps?.items.some((item) => item.group === "required" && item.state === "missing") === true;
}
