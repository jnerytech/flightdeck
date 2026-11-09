import { describe, expect, test } from "bun:test";
import {
  COMPARE_FIELDS,
  type CompareValues,
  compareHosts,
  featureDiff,
  type HostFacts,
  hasFix,
  hostFacts,
} from "../src/lib/host-compare.ts";

const NONE: CompareValues = {
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

const FIELDS = [
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

const facts = (hostId: string, values: Partial<CompareValues>): HostFacts => ({
  hostId,
  values: { ...NONE, ...values },
});

const rowOf = (hosts: HostFacts[], field: (typeof COMPARE_FIELDS)[number]) => {
  const row = compareHosts(hosts).find((r) => r.field === field);
  expect(row?.field).toBe(field);
  return row ?? { field, majority: null, cells: [] };
};

const markedIds = (hosts: HostFacts[], field: (typeof COMPARE_FIELDS)[number]) =>
  rowOf(hosts, field)
    .cells.filter((c) => c.marked)
    .map((c) => c.hostId);

describe("host-compare: the table's rows and cells", () => {
  test("there is one row per field, in the order shown, and one cell per host in the order given", () => {
    const rows = compareHosts([facts("a", {}), facts("b", {}), facts("c", {})]);
    expect(rows.map((r) => r.field)).toEqual([...FIELDS]);
    expect(COMPARE_FIELDS).toEqual(FIELDS);
    for (const row of rows) expect(row.cells.map((c) => c.hostId)).toEqual(["a", "b", "c"]);
  });

  test("a cell carries the host's own value for that field", () => {
    const hosts = [
      facts("a", { daemon: "1.4.0", claude: "2.1.0" }),
      facts("b", { daemon: "1.3.0" }),
    ];
    expect(rowOf(hosts, "daemon").cells.map((c) => c.value)).toEqual(["1.4.0", "1.3.0"]);
    expect(rowOf(hosts, "claude").cells.map((c) => c.value)).toEqual(["2.1.0", null]);
  });
});

describe("host-compare: the majority rule", () => {
  test("the host that differs from the value most hosts share is marked, and the row names that value", () => {
    const hosts = [
      facts("a", { daemon: "1.4.0" }),
      facts("b", { daemon: "1.4.0" }),
      facts("c", { daemon: "1.3.0" }),
    ];
    expect(markedIds(hosts, "daemon")).toEqual(["c"]);
    expect(rowOf(hosts, "daemon").majority).toBe("1.4.0");
  });

  test("every host off the majority is marked, even when they differ from each other", () => {
    const hosts = [
      facts("a", { claude: "2.1.0" }),
      facts("b", { claude: "2.1.0" }),
      facts("c", { claude: "2.0.0" }),
      facts("d", { claude: "1.9.0" }),
    ];
    expect(markedIds(hosts, "claude")).toEqual(["c", "d"]);
  });

  test("hosts that all agree mark nothing", () => {
    const hosts = [
      facts("a", { hooks: "ok" }),
      facts("b", { hooks: "ok" }),
      facts("c", { hooks: "ok" }),
    ];
    expect(markedIds(hosts, "hooks")).toEqual([]);
    expect(rowOf(hosts, "hooks").majority).toBeNull();
  });

  test("a tie marks no cell, since there is no majority to differ from", () => {
    const two = [facts("a", { daemon: "1.4.0" }), facts("b", { daemon: "1.3.0" })];
    expect(markedIds(two, "daemon")).toEqual([]);
    expect(rowOf(two, "daemon").majority).toBeNull();
    const four = [
      facts("a", { signin: "ok" }),
      facts("b", { signin: "ok" }),
      facts("c", { signin: "missing" }),
      facts("d", { signin: "missing" }),
    ];
    expect(markedIds(four, "signin")).toEqual([]);
  });

  test("a missing value shows as a dash, is never marked and does not vote", () => {
    const hosts = [
      facts("a", { claude: "2.1.0" }),
      facts("b", { claude: "2.1.0" }),
      facts("c", { claude: null }),
      facts("d", { claude: null }),
      facts("e", { claude: null }),
    ];
    expect(markedIds(hosts, "claude")).toEqual([]);
    expect(rowOf(hosts, "claude").cells.map((c) => c.value)).toEqual([
      "2.1.0",
      "2.1.0",
      null,
      null,
      null,
    ]);
  });

  test("a missing value beside a real majority leaves the majority's outlier marked and the dash alone", () => {
    const hosts = [
      facts("a", { hooks: "ok" }),
      facts("b", { hooks: "ok" }),
      facts("c", { hooks: "outdated" }),
      facts("d", { hooks: null }),
    ];
    expect(markedIds(hosts, "hooks")).toEqual(["c"]);
  });

  test("missing values do not count as a vote that could tie with the real majority", () => {
    // Two agree, one differs, two are missing: if the dashes voted they would tie the majority.
    const hosts = [
      facts("a", { hooks: "ok" }),
      facts("b", { hooks: "ok" }),
      facts("c", { hooks: "warn" }),
      facts("d", { hooks: null }),
      facts("e", { hooks: null }),
    ];
    expect(markedIds(hosts, "hooks")).toEqual(["c"]);
  });

  test("one known value alone has nothing to differ from", () => {
    expect(markedIds([facts("a", { daemon: "1.4.0" }), facts("b", {})], "daemon")).toEqual([]);
    expect(markedIds([facts("a", { daemon: "1.4.0" })], "daemon")).toEqual([]);
  });

  test("each row is judged on its own", () => {
    const hosts = [
      facts("a", { daemon: "1.4.0", hooks: "ok" }),
      facts("b", { daemon: "1.4.0", hooks: "ok" }),
      facts("c", { daemon: "1.3.0", hooks: "fail" }),
    ];
    expect(markedIds(hosts, "daemon")).toEqual(["c"]);
    expect(markedIds(hosts, "hooks")).toEqual(["c"]);
    expect(markedIds(hosts, "claude")).toEqual([]);
  });

  test("no hosts give a row per field with no cells", () => {
    const rows = compareHosts([]);
    expect(rows.map((r) => r.field)).toEqual([...FIELDS]);
    expect(rows.map((r) => r.cells.length)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("host-compare: what a host reports for each field", () => {
  const input = {
    hostId: "alfa",
    online: true,
    info: {
      os: "linux",
      daemonVersion: "1.4.0",
      claudeVersion: "2.1.0",
      features: ["central", "account", "doctor.run"],
    },
    doctor: {
      checks: [
        { id: "daemon" as const, status: "ok" as const, detail: "running" },
        { id: "hooks" as const, status: "warn" as const, detail: "outdated: limited" },
      ],
    },
    deps: {
      items: [
        { id: "git" as const, state: "ok" as const },
        { id: "claudeAuth" as const, state: "missing" as const },
        { id: "service" as const, state: "missing" as const },
        { id: "gh" as const, state: "ok" as const },
        { id: "az" as const, state: "outdated" as const },
        { id: "hooks" as const, state: "outdated" as const },
      ],
    },
  };

  test("the OS and versions come from host.info, the rest from the dependencies the app already holds", () => {
    expect(hostFacts(input)).toEqual({
      hostId: "alfa",
      values: {
        os: "linux",
        daemon: "1.4.0",
        claude: "2.1.0",
        hooks: "outdated",
        signin: "missing",
        gh: "ok",
        az: "outdated",
        boot: "missing",
        features: "account,central,doctor.run",
      },
    });
  });

  test("hooks are outdated or absent as the dependency says, never the doctor's Warning", () => {
    const absent = {
      ...input,
      deps: { items: [{ id: "hooks" as const, state: "missing" as const }] },
    };
    expect(hostFacts(absent).values.hooks).toBe("missing");
    expect(hostFacts(input).values.hooks).toBe("outdated");
  });

  test("without the dependencies, hooks fall back to the doctor only when it says they are fine", () => {
    const doctor = (status: "ok" | "warn") => ({
      checks: [{ id: "hooks" as const, status, detail: "x" }],
    });
    expect(hostFacts({ ...input, deps: undefined, doctor: doctor("ok") }).values.hooks).toBe("ok");
    expect(
      hostFacts({ ...input, deps: undefined, doctor: doctor("warn") }).values.hooks,
    ).toBeNull();
  });

  test("the features are the same text however the host orders them", () => {
    const other = {
      ...input,
      info: { ...input.info, features: ["doctor.run", "central", "account"] },
    };
    expect(hostFacts(other).values.features).toBe("account,central,doctor.run");
  });

  test("what the host does not report is missing, not a guess", () => {
    const bare = hostFacts({
      hostId: "old",
      online: true,
      info: { os: "linux", daemonVersion: "1.0.0", claudeVersion: null },
      doctor: undefined,
      deps: undefined,
    });
    expect(bare.values).toEqual({ ...NONE, os: "linux", daemon: "1.0.0" });
  });

  test("a check or dependency that is not in the answer is missing", () => {
    const partial = hostFacts({
      ...input,
      doctor: { checks: [{ id: "daemon", status: "ok", detail: "running" }] },
      deps: { items: [{ id: "git", state: "ok" }] },
    });
    expect(partial.values.hooks).toBeNull();
    expect(partial.values.signin).toBeNull();
    expect(partial.values.gh).toBeNull();
    expect(partial.values.az).toBeNull();
    expect(partial.values.boot).toBeNull();
  });

  test("a host that is not online has nothing to compare, so every field is missing", () => {
    expect(hostFacts({ ...input, online: false }).values).toEqual(NONE);
  });
});

describe("host-compare: which marked cells have a fix to link to", () => {
  test("a lacking hook, sign-in, tool or boot service links to the fix the host's page already has", () => {
    for (const field of ["hooks", "signin", "gh", "az", "boot"] as const) {
      expect(hasFix(field, "missing")).toBe(true);
      expect(hasFix(field, "outdated")).toBe(true);
      expect(hasFix(field, "ok")).toBe(false);
      expect(hasFix(field, "na")).toBe(false);
    }
  });

  test("an older daemon links to its update, and what the app has no fix for does not link", () => {
    expect(hasFix("daemon", "1.3.0")).toBe(true);
    for (const field of ["os", "claude", "features"] as const) {
      expect(hasFix(field, "missing")).toBe(false);
    }
  });

  test("a value the host does not report has nothing to fix", () => {
    expect(hasFix("hooks", null)).toBe(false);
    expect(hasFix("daemon", null)).toBe(false);
  });
});

describe("host-compare: which features differ", () => {
  const set = (...names: string[]) => [...names].sort().join(",");
  const FULL = set("checkLoop", "doctor.run", "stall");

  const row = (hosts: HostFacts[]) => rowOf(hosts, "features");
  const diffOf = (hosts: HostFacts[], hostId: string) => {
    const r = row(hosts);
    const cell = r.cells.find((c) => c.hostId === hostId);
    return featureDiff(cell?.value ?? null, r.majority);
  };

  test("a feature most hosts have and one host lacks is named as missing on that host", () => {
    const hosts = [
      facts("a", { features: FULL }),
      facts("b", { features: FULL }),
      facts("c", { features: set("doctor.run") }),
    ];
    expect(markedIds(hosts, "features")).toEqual(["c"]);
    expect(diffOf(hosts, "c")).toEqual({ missing: ["checkLoop", "stall"], extra: [] });
    expect(diffOf(hosts, "a")).toEqual({ missing: [], extra: [] });
  });

  test("a feature one host has and most hosts lack is named as extra on that host", () => {
    const hosts = [
      facts("a", { features: set("doctor.run") }),
      facts("b", { features: set("doctor.run") }),
      facts("c", { features: set("doctor.run", "quota") }),
    ];
    expect(markedIds(hosts, "features")).toEqual(["c"]);
    expect(diffOf(hosts, "c")).toEqual({ missing: [], extra: ["quota"] });
  });

  test("a host can lack one feature and have another at once", () => {
    const hosts = [
      facts("a", { features: set("doctor.run", "stall") }),
      facts("b", { features: set("doctor.run", "stall") }),
      facts("c", { features: set("doctor.run", "quota") }),
    ];
    expect(diffOf(hosts, "c")).toEqual({ missing: ["stall"], extra: ["quota"] });
  });

  test("a host with no features at all lacks every one of the majority's", () => {
    const hosts = [
      facts("a", { features: set("stall") }),
      facts("b", { features: set("stall") }),
      facts("c", { features: "" }),
    ];
    expect(diffOf(hosts, "c")).toEqual({ missing: ["stall"], extra: [] });
  });

  test("a tie has no majority, so no host is marked and none lacks or adds anything", () => {
    const hosts = [facts("a", { features: FULL }), facts("b", { features: set("doctor.run") })];
    expect(markedIds(hosts, "features")).toEqual([]);
    expect(row(hosts).majority).toBeNull();
    expect(diffOf(hosts, "a")).toEqual({ missing: [], extra: [] });
    expect(diffOf(hosts, "b")).toEqual({ missing: [], extra: [] });
  });

  test("hosts that do not report their features are not named, and do not vote", () => {
    const hosts = [
      facts("a", { features: FULL }),
      facts("b", { features: FULL }),
      facts("c", { features: null }),
    ];
    expect(markedIds(hosts, "features")).toEqual([]);
    expect(featureDiff(null, FULL)).toEqual({ missing: [], extra: [] });
  });
});
