import type { DepResult, DoctorResult, HostInfoResult } from "@flightdeck/protocol";

/** The things the table compares, one row each, in the order shown. */
export const COMPARE_FIELDS = [
  "os",
  "daemon",
  "claude",
  "hooks",
  "signin",
  "gh",
  "az",
  "boot",
  "features",
] as const;
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
  /** Differs from what most hosts have, or from the other hosts when none is the majority. Never set on a missing value. */
  marked: boolean;
}

export interface CompareRow {
  field: CompareField;
  /** What most hosts have, only when a cell is marked by it; `null` otherwise, and when tied. */
  majority: string | null;
  /** No majority, and the known values still differ: every known cell is marked. */
  tied: boolean;
  cells: CompareCell[];
}

const NOTHING: CompareValues = {
  os: null,
  daemon: null,
  claude: null,
  hooks: null,
  signin: null,
  gh: null,
  az: null,
  boot: null,
  features: null,
};

export interface HostFactsInput {
  hostId: string;
  online: boolean;
  info: Pick<HostInfoResult, "os" | "daemonVersion" | "claudeVersion" | "features"> | undefined;
  doctor: Pick<DoctorResult, "checks"> | undefined;
  deps: { items: ReadonlyArray<Pick<DepResult, "id" | "state">> } | undefined;
}

/**
 * Hooks as the dependency says (`ok`, `outdated`, `missing`). A host with no dependency check only
 * has the doctor's status, which cannot tell absent from outdated: it counts when it says `ok`.
 */
function hooksOf(input: HostFactsInput): string | null {
  const dep = input.deps?.items.find((item) => item.id === "hooks");
  if (dep) return dep.state;
  return input.doctor?.checks.find((check) => check.id === "hooks")?.status === "ok" ? "ok" : null;
}

/** What a host reports for each field, read from what the app already holds for it. */
export function hostFacts(input: HostFactsInput): HostFacts {
  const { info, deps } = input;
  if (!input.online) return { hostId: input.hostId, values: { ...NOTHING } };
  const dep = (id: DepResult["id"]) => deps?.items.find((item) => item.id === id)?.state ?? null;
  return {
    hostId: input.hostId,
    values: {
      os: info?.os ?? null,
      daemon: info?.daemonVersion ?? null,
      claude: info?.claudeVersion ?? null,
      hooks: hooksOf(input),
      signin: dep("claudeAuth"),
      gh: dep("gh"),
      az: dep("az"),
      boot: dep("service"),
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

/**
 * One row per field. A cell is marked when its value differs from the one most hosts share; with no
 * such value (two hosts, an even split) and known values that still differ, every known cell is.
 */
export function compareHosts(hosts: readonly HostFacts[]): CompareRow[] {
  return COMPARE_FIELDS.map((field) => {
    const values = hosts.map((host) => host.values[field]);
    const majority = majorityOf(values);
    const tied = majority === null && new Set(values.filter((v) => v !== null)).size > 1;
    const cells = hosts.map((host, index) => {
      const value = values[index] ?? null;
      return {
        hostId: host.hostId,
        value,
        marked: value !== null && (tied || (majority !== null && value !== majority)),
      };
    });
    return { field, majority: cells.some((cell) => cell.marked) ? majority : null, tied, cells };
  });
}

export interface FeatureDiff {
  /** What most hosts have and this one lacks, sorted. */
  missing: string[];
  /** What this host has and most hosts lack, sorted. */
  extra: string[];
}

const featureList = (value: string): string[] => (value === "" ? [] : value.split(","));

/**
 * Which features a host's set (the `features` value) lacks or adds against the set most hosts have
 * (the row's `majority`). With no majority, a tie or a host that does not report, there is nothing
 * to differ from, so both lists are empty.
 */
export function featureDiff(value: string | null, majority: string | null): FeatureDiff {
  if (value === null || majority === null) return { missing: [], extra: [] };
  const has = new Set(featureList(value));
  const common = new Set(featureList(majority));
  return {
    missing: [...common].filter((name) => !has.has(name)),
    extra: [...has].filter((name) => !common.has(name)),
  };
}

/** The fields whose lack the host's page (Health & dependencies) already has a fix for. */
const FIXED_WHEN_LACKING: ReadonlySet<CompareField> = new Set([
  "hooks",
  "signin",
  "gh",
  "az",
  "boot",
]);

/**
 * Whether a cell has a fix the app already offers on its host's page: what is missing or outdated
 * has its install, sign-in or turn-on there, and an older daemon has its update. The OS, the Claude
 * Code version and the features have none.
 */
export function hasFix(field: CompareField, value: string | null): boolean {
  if (value === null) return false;
  if (field === "daemon") return true;
  return FIXED_WHEN_LACKING.has(field) && (value === "missing" || value === "outdated");
}

/**
 * Which features a host lacks or adds when no set is the majority (two hosts, an even split): it
 * lacks what any other host has and it does not, and adds what it has and any other host lacks.
 */
export function featureDiffTied(
  value: string | null,
  values: ReadonlyArray<string | null>,
): FeatureDiff {
  if (value === null) return { missing: [], extra: [] };
  const own = new Set(featureList(value));
  const others = values.flatMap((other) => (other === null ? [] : [new Set(featureList(other))]));
  const union = new Set(others.flatMap((set) => [...set]));
  const shared = [...union].filter((name) => others.every((set) => set.has(name)));
  return {
    missing: [...union].filter((name) => !own.has(name)).sort((a, b) => a.localeCompare(b)),
    extra: [...own].filter((name) => !shared.includes(name)).sort((a, b) => a.localeCompare(b)),
  };
}
