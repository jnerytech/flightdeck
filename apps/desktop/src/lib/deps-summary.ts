import type { DepResult } from "@flightdeck/protocol";

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

export function depsSummary(_items: DepResult[]): DepsSummary {
  return { kind: "ok", n: 0 };
}

export function depLook(_item: DepResult): DepLook {
  return { icon: "dash", tone: "off" };
}

/** The command that installs or upgrades the dependency on the host's own OS, or null. */
export function fixFor(_item: DepResult, _os: string): string | null {
  return null;
}
