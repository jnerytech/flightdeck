import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CliDeps, parseArgs, runCli } from "../../src/main.ts";
import { statusLines } from "../../src/maintenance/domain/maintenance-cli-view.ts";
import { tempDir } from "../support/helpers.ts";

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);

/** A host's data folder and its config, with no database yet: the command opens it and migrates it. */
function host() {
  const dir = tempDir("fd-maint-cli-");
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
  const config = join(dir, "config.json");
  writeFileSync(config, JSON.stringify({ token: "t".repeat(32), dataDir }));
  return { dir, dataDir, config };
}

async function run(argv: string[], extra: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  let code = null as number | null;
  await runCli(argv, {
    env: {},
    log: { log: (m) => out.push(m), error: (m) => err.push(m) },
    exit: (c) => {
      code = c;
    },
    onSignal: () => {},
    now: () => NOW,
    ...extra,
  });
  return { code, out, err };
}

const printed = (out: string[]) => {
  try {
    return JSON.parse(out.join("\n")) as unknown;
  } catch {
    return null;
  }
};

const COUNTS = {
  events: 6,
  permission_requests: 2,
  external_sessions: 1,
  usage_entries: 0,
  quota_samples: 4,
};

describe("flightdeckd db status: what it says (#3756)", () => {
  test("one line per fact: the size, the counts, the last backup, the backups kept and the last cleanup", () => {
    const first = {
      path: "/d/backups/flightdeck-20261030-120000.db",
      at: "2026-10-30T12:00:00.000Z",
      bytes: 8192,
    };
    const older = {
      path: "/d/backups/flightdeck-20261029-120000.db",
      at: "2026-10-29T12:00:00.000Z",
      bytes: 4096,
    };
    expect(
      statusLines({
        dbBytes: 1_048_576,
        lastBackup: first,
        backups: [first, older],
        lastPrune: { at: "2026-10-30T11:00:00.000Z", dryRun: true, counts: COUNTS },
        counts: { sessions: 3, events: 120, externalSessions: 2 },
      }),
    ).toEqual([
      "database: 1048576 bytes",
      "sessions: 3, events: 120, external sessions: 2",
      "last backup: 2026-10-30T12:00:00.000Z, 8192 bytes",
      "backups kept: 2",
      "  2026-10-30T12:00:00.000Z  8192 bytes  /d/backups/flightdeck-20261030-120000.db",
      "  2026-10-29T12:00:00.000Z  4096 bytes  /d/backups/flightdeck-20261029-120000.db",
      "last cleanup: 2026-10-30T11:00:00.000Z, dry run (nothing was deleted)",
      "  events: 6",
      "  permission_requests: 2",
      "  external_sessions: 1",
      "  usage_entries: 0",
      "  quota_samples: 4",
    ]);
  });

  test("no backup and no cleanup say so", () => {
    expect(
      statusLines({
        dbBytes: 4096,
        lastBackup: null,
        backups: [],
        lastPrune: null,
        counts: { sessions: 0, events: 0, externalSessions: 0 },
      }),
    ).toEqual([
      "database: 4096 bytes",
      "sessions: 0, events: 0, external sessions: 0",
      "last backup: none",
      "backups kept: 0",
      "last cleanup: none",
    ]);
  });

  test("a cleanup that deleted says done", () => {
    const lines = statusLines({
      dbBytes: 4096,
      lastBackup: null,
      backups: [],
      lastPrune: { at: "2026-10-30T11:00:00.000Z", dryRun: false, counts: COUNTS },
      counts: { sessions: 0, events: 0, externalSessions: 0 },
    });
    expect(lines).toContain("last cleanup: 2026-10-30T11:00:00.000Z, done");
  });
});

describe("flightdeckd db status, db prune, backup and doctor: --json (#3756)", () => {
  test("db status --json is the maintenance status, null and empty on a host that has done nothing", async () => {
    const { config } = host();
    const run1 = await run(["db", "status", "--json", "--config", config]);
    expect(run1.code).toBe(0);
    expect(printed(run1.out)).toEqual({
      dbBytes: expect.any(Number),
      lastBackup: null,
      backups: [],
      lastPrune: null,
      counts: { sessions: 0, events: 0, externalSessions: 0 },
    });
  });

  test("after a backup and a dry run, it lists them, newest first, with the cleanup's counts", async () => {
    const { dataDir, config } = host();
    await run(["backup", "--config", config]);
    await run(["db", "prune", "--dry-run", "--config", config]);
    const json = await run(["db", "status", "--json", "--config", config]);
    const status = printed(json.out) as {
      lastBackup: { path: string; at: string; bytes: number };
      backups: unknown[];
      lastPrune: { at: string; dryRun: boolean; counts: Record<string, number> };
    };
    expect(status.lastBackup.path).toBe(join(dataDir, "backups", "flightdeck-20261030-120000.db"));
    expect(status.backups).toHaveLength(1);
    expect(status.lastPrune).toMatchObject({ at: "2026-10-30T12:00:00.000Z", dryRun: true });
    expect(Object.keys(status.lastPrune.counts)).toContain("events");
    const text = await run(["db", "status", "--config", config]);
    expect(text.code).toBe(0);
    expect(text.out).toContain("backups kept: 1");
    expect(text.out).toContain(
      "last cleanup: 2026-10-30T12:00:00.000Z, dry run (nothing was deleted)",
    );
  });

  test("db prune --json is the dry-run flag and the count per table, and --dry-run deletes nothing", async () => {
    const { config } = host();
    const dry = await run(["db", "prune", "--dry-run", "--json", "--config", config]);
    const real = await run(["db", "prune", "--json", "--config", config]);
    expect(dry.code).toBe(0);
    expect(printed(dry.out)).toEqual({
      dryRun: true,
      counts: expect.objectContaining({ events: 0 }),
    });
    expect(printed(real.out)).toEqual({
      dryRun: false,
      counts: expect.objectContaining({ events: 0 }),
    });
    expect(dry.out).toHaveLength(1);
  });

  test("backup --json --out <file> is the path, the time and the size of that file", async () => {
    const { dir, config } = host();
    const out = join(dir, "copy.db");
    const json = await run(["backup", "--json", "--out", out, "--config", config]);
    expect(json.code).toBe(0);
    expect(printed(json.out)).toEqual({
      path: out,
      at: expect.any(String),
      bytes: expect.any(Number),
    });
  });

  test("without --json the three keep their plain lines", async () => {
    const { dataDir, config } = host();
    const backup = await run(["backup", "--config", config]);
    expect(backup.out).toEqual([
      expect.stringContaining(
        `backup created: ${join(dataDir, "backups", "flightdeck-20261030-120000.db")} (`,
      ),
    ]);
    const prune = await run(["db", "prune", "--dry-run", "--config", config]);
    expect(prune.out[0]).toBe("dry run of the cleanup (nothing was deleted):");
  });

  test("doctor --json is one value: the checks with their fix, and the dependencies; exit 1 on a failure", async () => {
    // A config below a regular file cannot be read or created, on any platform.
    const blocker = join(tempDir("fd-doctor-json-"), "file");
    writeFileSync(blocker, "x");
    const lines = await run(["doctor", "--json", "--config", join(blocker, "config.json")], {
      exec: async () => ({ code: 1, stdout: "" }),
    });
    expect(lines.code).toBe(1);
    expect(lines.out).toHaveLength(1);
    expect(printed(lines.out)).toMatchObject({
      ok: false,
      checks: expect.arrayContaining([expect.objectContaining({ name: "config", status: "fail" })]),
      deps: { items: expect.any(Array) },
    });
  });
});

describe("flightdeckd db status, backup and doctor: the words (#3756)", () => {
  const argsOf = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };
  const refused = (argv: string[]) => (argsOf(argv) as { refusedWith?: string }).refusedWith;

  test("`db status|prune` take --json; an action that is neither is refused", () => {
    expect(argsOf(["db", "status", "--json"])).toMatchObject({
      command: "db",
      action: "status",
      json: true,
    });
    expect(argsOf(["db", "prune", "--dry-run", "--json"])).toMatchObject({
      command: "db",
      action: "prune",
      dryRun: true,
      json: true,
    });
    expect(refused(["db", "vacuum"])).toContain("invalid db action: vacuum");
  });

  test("backup and doctor take --json", () => {
    expect(argsOf(["backup", "--json", "--out", "x.db"])).toMatchObject({
      command: "backup",
      json: true,
    });
    expect(argsOf(["doctor", "--json"])).toMatchObject({ command: "doctor", json: true });
  });

  test("restore does not take --json, and none of them takes --host: they act on this machine", () => {
    expect(refused(["restore", "x.db", "--json"])).toContain("--json: this flag only applies to");
    for (const argv of [
      ["db", "status", "--host", "pi"],
      ["backup", "--host", "pi"],
      ["doctor", "--host", "pi"],
    ])
      expect(refused(argv)).toContain("--host: this flag only applies to");
  });
});
