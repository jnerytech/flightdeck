import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UsageLedger } from "../../src/quota/usage.ts";
import { createQuota, createUsage } from "../../src/quota/wiring.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { tempDir } from "../support/helpers.ts";

/**
 * The plan quota as main.ts builds it (phase 7, #1593): a session's readings reach both the guard
 * and the history, and the pause is written to the config file before the guard takes it.
 */
function quota(configFile = join(tempDir("fd-quota-wiring-"), "config.json")) {
  const store = new EventStore(":memory:");
  const config = { quota: { pauseAt: null as number | null } };
  const built = createQuota({ db: store.db, config, configFile });
  // The history and the pause reach main.ts only through the module's server group (#2094).
  const group = built.modules[0].server?.quota;
  if (!group?.history || !group.pause) throw new Error("the quota module has no server group");
  return { built, history: group.history, pause: group.pause, config, configFile };
}

describe("quota-wiring: the host's plan quota, its history and its pause (#1593)", () => {
  test("a session's readings reach both the guard and the history", () => {
    const { built, history } = quota();
    const resetsAt = Date.now() + 60 * 60 * 1000;
    built.onQuota([{ window: "five_hour", utilization: 0.4, status: "allowed", resetsAt }]);
    expect(built.quota.windows().map((w) => w.window)).toEqual(["five_hour"]);
    expect(history.history("five_hour", 1).samples.map((s) => s.utilization)).toEqual([0.4]);
  });

  test("the pause is written to the config file, then the config and the guard take it", async () => {
    const { built, pause, config, configFile } = quota();
    writeFileSync(configFile, JSON.stringify({ port: 0, quota: { other: 1 } }));
    await pause.set(0.8);
    expect(JSON.parse(readFileSync(configFile, "utf8")).quota).toEqual({ other: 1, pauseAt: 0.8 });
    expect(config.quota.pauseAt).toBe(0.8);
    expect(built.quota.state().pauseAt).toBe(0.8);
  });

  test("a pause the config file cannot take leaves the config and the guard as they were", async () => {
    const { built, pause, config } = quota(
      join(tempDir("fd-quota-wiring-"), "missing", "config.json"),
    );
    let failed = false;
    await Promise.resolve(pause.set(0.8)).catch(() => {
      failed = true;
    });
    expect(failed).toBe(true);
    expect(config.quota.pauseAt).toBeNull();
    expect(built.quota.state().pauseAt).toBeNull();
  });
});

describe("usage-wiring: the ledger of every turn, as the module the server takes `usage` from", () => {
  test("the server and the sessions read one ledger, kept on the host's store", () => {
    const { db } = new EventStore(":memory:");
    const built = createUsage({ db, projectKey: (cwd) => `p:${cwd}` });
    expect(built.usage).toBeInstanceOf(UsageLedger);
    expect(built.modules[0].server?.usage).toBe(built.usage);
  });
});
