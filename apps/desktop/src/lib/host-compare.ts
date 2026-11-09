import type { DepResult, DoctorResult, HostInfoResult } from "@flightdeck/protocol";

/** The things the table compares, one row each, in the order shown. */
export const COMPARE_FIELDS = ["daemon", "claude", "hooks", "signin", "features"] as const;
export type CompareField = (typeof COMPARE_FIELDS)[number];

/** What one host has for each field; `null` is not known (offline, an older daemon, not asked yet). */
export type CompareValues = Record<CompareField, string | null>;

export interface HostFacts {
  hostId: string;
  values: CompareValues;
}

export interface CompareCell {
  hostId: string;
  value: string | null;
  /** Differs from what most hosts have. Never set on a missing value. */
  marked: boolean;
}

export interface CompareRow {
  field: CompareField;
  /** What most hosts have, only when a cell is marked; `null` otherwise. */
  majority: string | null;
  cells: CompareCell[];
}

const NOTHING: CompareValues = {
  daemon: null,
  claude: null,
  hooks: null,
  signin: null,
  features: null,
};

export interface HostFactsInput {
  hostId: string;
  online: boolean;
  info: Pick<HostInfoResult, "daemonVersion" | "claudeVersion" | "features"> | undefined;
  doctor: Pick<DoctorResult, "checks"> | undefined;
  deps: { items: ReadonlyArray<Pick<DepResult, "id" | "state">> } | undefined;
}

/** What a host reports for each field, read from what the app already holds for it. */
export function hostFacts(input: HostFactsInput): HostFacts {
  const { info, doctor, deps } = input;
  if (!input.online) return { hostId: input.hostId, values: { ...NOTHING } };
  return {
    hostId: input.hostId,
    values: {
      daemon: info?.daemonVersion ?? null,
      claude: info?.claudeVersion ?? null,
      hooks: doctor?.checks.find((check) => check.id === "hooks")?.status ?? null,
      signin: deps?.items.find((item) => item.id === "claudeAuth")?.state ?? null,
      // Sorted, so the same set reads the same whatever order a host lists it in.
      features: info?.features
        ? [...info.features].sort((a, b) => a.localeCompare(b)).join(",")
        : null,
    },
  };
}

/** The value more known values agree on than any other; `null` when two or more tie for the lead. */
function majorityOf(values: ReadonlyArray<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const [lead, runnerUp] = ranked;
  if (!lead || (runnerUp && runnerUp[1] === lead[1])) return null;
  return lead[0];
}

/** One row per field; a cell is marked when its value differs from the one most hosts share. */
export function compareHosts(hosts: readonly HostFacts[]): CompareRow[] {
  return COMPARE_FIELDS.map((field) => {
    const values = hosts.map((host) => host.values[field]);
    const majority = majorityOf(values);
    const cells = hosts.map((host, index) => {
      const value = values[index] ?? null;
      return {
        hostId: host.hostId,
        value,
        marked: majority !== null && value !== null && value !== majority,
      };
    });
    return { field, majority: cells.some((cell) => cell.marked) ? majority : null, cells };
  });
}
