import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createQuota } from "../../src/quota/wiring.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { tempDir } from "../helpers.ts";

/**
 * The plan quota as main.ts builds it (phase 7, #1593): a session's readings reach both the guard
 * and the history, and the pause is written to the config file before the guard takes it.
 */
function quota(configFile = join(tempDir("fd-quota-wiring-"), "config.json")) {
  const store = new EventStore(":memory:");
  const config = { quota: { pauseAt: null as number | null } };
  return { built: createQuota({ db: store.db, config, configFile }), config, configFile };
}

describe("quota-wiring: the host's plan quota, its history and its pause (#1593)", () => {
  test("a session's readings reach both the guard and the history", () => {
    const { built } = quota();
    const resetsAt = Date.now() + 60 * 60 * 1000;
    built.onQuota([{ window: "five_hour", utilization: 0.4, status: "allowed", resetsAt }]);
    expect(built.quota.windows().map((w) => w.window)).toEqual(["five_hour"]);
    expect(built.quotaHistory.history("five_hour", 1).samples.map((s) => s.utilization)).toEqual([
      0.4,
    ]);
  });

  test("the pause is written to the config file, then the config and the guard take it", async () => {
    const { built, config, configFile } = quota();
    writeFileSync(configFile, JSON.stringify({ port: 0, quota: { other: 1 } }));
    await built.quotaPause.set(0.8);
    expect(JSON.parse(readFileSync(configFile, "utf8")).quota).toEqual({ other: 1, pauseAt: 0.8 });
    expect(config.quota.pauseAt).toBe(0.8);
    expect(built.quota.state().pauseAt).toBe(0.8);
  });

  test("a pause the config file cannot take leaves the config and the guard as they were", async () => {
    const { built, config } = quota(join(tempDir("fd-quota-wiring-"), "missing", "config.json"));
    let failed = false;
    await built.quotaPause.set(0.8).catch(() => {
      failed = true;
    });
    expect(failed).toBe(true);
    expect(config.quota.pauseAt).toBeNull();
    expect(built.quota.state().pauseAt).toBeNull();
  });
});
