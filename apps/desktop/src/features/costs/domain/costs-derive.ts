import type { CostsSummary } from "@flightdeck/protocol";
import { hasFeature, hostsWith } from "../../../lib/version.ts";

/** What the costs screen reads of a host. */
export interface CostsHost {
  id: string;
  status: string;
  hostInfo?: { features?: readonly string[] } | null;
}

/** The online hosts that report costs. */
export function costsHosts<H extends CostsHost>(hosts: readonly H[]): H[] {
  return hostsWith(hosts, "costs");
}

/** Of the hosts in view (`hostIds`), those that offer `feature`. */
export function hostsOffering<H extends CostsHost>(
  hosts: readonly H[],
  hostIds: readonly string[],
  feature: string,
): H[] {
  return hosts.filter(
    (h) => hostIds.includes(h.id) && hasFeature(h.hostInfo?.features, feature, false),
  );
}

type Projects = Pick<CostsSummary, "byProject"> | null;

/** The projects of the period, for the scope menu; the chosen one stays listed. */
export function periodProjectKeys(all: Projects, projectKey: string | null): string[] {
  return [
    ...new Set([
      ...(all?.byProject ?? []).map((p) => p.projectKey),
      ...(projectKey ? [projectKey] : []),
    ]),
  ];
}

/** Every project key the screen shows a label for, once each. */
export function labelledKeys(
  shown: { all: Projects; summary: (Projects & Pick<CostsSummary, "topSessions">) | null },
  projectKey: string | null,
): string[] {
  const { all, summary } = shown;
  return [
    ...new Set([
      ...(all?.byProject ?? []).map((p) => p.projectKey),
      ...(summary?.byProject ?? []).map((p) => p.projectKey),
      ...(summary?.topSessions ?? []).map((s) => s.projectKey),
      ...(projectKey ? [projectKey] : []),
    ]),
  ];
}

/** The filters with `name` set to `value`, or without it when the value is empty. */
export function withFilter<F extends object>(filters: F, name: keyof F, value: string): F {
  const { [name]: _old, ...rest } = filters;
  return (value ? { ...rest, [name]: value } : rest) as F;
}
