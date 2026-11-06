import { describe, expect, test } from "bun:test";
import type { DaemonManifest } from "@flightdeck/protocol";
import { AutoUpdater } from "../src/updates/auto.ts";

const manifest = (version: string): DaemonManifest => ({
  version,
  protocol: 1,
  assets: {},
});

/** An updater over fakes: a settable host, manifest and setting, and timers that wait for the test. */
function setup(
  opts: {
    enabled?: boolean;
    current?: string;
    latest?: DaemonManifest | null;
    idle?: boolean;
  } = {},
) {
  const state = {
    enabled: opts.enabled ?? true,
    latest: opts.latest === undefined ? manifest("0.38.0") : opts.latest,
    idle: opts.idle ?? true,
    applyError: null as Error | null,
  };
  const applied: string[] = [];
  const lines: string[] = [];
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const auto = new AutoUpdater({
    enabled: () => state.enabled,
    currentVersion: opts.current ?? "0.37.0",
    latest: () => state.latest,
    idle: () => state.idle,
    apply: async () => {
      applied.push(state.latest?.version ?? "?");
      if (state.applyError) throw state.applyError;
      return { started: true };
    },
    retryMs: 60_000,
    now: () => Date.parse("2026-11-06T14:02:00.000Z"),
    timers: {
      set: (fn, ms) => {
        const timer = { fn, ms, cleared: false };
        timers.push(timer);
        return timer;
      },
      clear: (handle) => {
        (handle as { cleared: boolean }).cleared = true;
      },
    },
    log: (line) => lines.push(line),
  });
  const waiting = () => timers.filter((t) => !t.cleared);
  return { auto, state, applied, lines, timers, waiting };
}

describe("auto-update: the daemon applies a newer version by itself, only when the host is idle (#280)", () => {
  test("an idle host with a newer version applies it, and says when", async () => {
    const t = setup();
    await t.auto.tick();
    expect(t.applied).toEqual(["0.38.0"]);
    expect(t.auto.status()).toEqual({
      enabled: true,
      state: "started",
      version: "0.38.0",
      at: "2026-11-06T14:02:00.000Z",
    });
  });

  test("the update is started once: a second look does not apply it again", async () => {
    const t = setup();
    await t.auto.tick();
    await t.auto.tick();
    await t.auto.checked();
    expect(t.applied).toEqual(["0.38.0"]);
  });

  test("a busy host waits, looks again after the retry time, and applies once it is idle", async () => {
    const t = setup({ idle: false });
    await t.auto.tick();
    expect(t.applied).toEqual([]);
    expect(t.auto.status()).toEqual({ enabled: true, state: "waiting", version: "0.38.0" });
    expect(t.waiting().map((x) => x.ms)).toEqual([60_000]);
    // Still busy at the next look: it waits again, one timer at a time.
    t.waiting()[0]?.fn();
    await Promise.resolve();
    await Promise.resolve();
    expect(t.applied).toEqual([]);
    expect(t.waiting()).toHaveLength(1);
    t.state.idle = true;
    t.waiting()[0]?.fn();
    await Promise.resolve();
    await Promise.resolve();
    expect(t.applied).toEqual(["0.38.0"]);
    expect(t.auto.status().state).toBe("started");
    expect(t.waiting()).toEqual([]);
  });

  test("the setting off applies nothing and waits for nothing", async () => {
    const t = setup({ enabled: false });
    await t.auto.tick();
    await t.auto.checked();
    expect(t.applied).toEqual([]);
    expect(t.auto.status()).toEqual({ enabled: false, state: "off" });
    expect(t.waiting()).toEqual([]);
  });

  test("the same version or an older one, or no manifest yet, is never applied (no downgrade)", async () => {
    for (const latest of [manifest("0.37.0"), manifest("0.36.9"), null]) {
      const t = setup({ latest });
      await t.auto.tick();
      expect(t.applied).toEqual([]);
      expect(t.auto.status()).toEqual({ enabled: true, state: "current" });
    }
  });

  test("a failed apply keeps the old version, is reported, and is tried again only after the next check", async () => {
    const t = setup();
    t.state.applyError = new Error("o sha256 do arquivo baixado não confere com o manifesto");
    await t.auto.tick();
    expect(t.auto.status()).toEqual({
      enabled: true,
      state: "failed",
      version: "0.38.0",
      reason: "o sha256 do arquivo baixado não confere com o manifesto",
      at: "2026-11-06T14:02:00.000Z",
    });
    expect(t.lines.join("\n")).toContain("0.38.0");
    // Looking again does not download the same thing over and over.
    await t.auto.tick();
    expect(t.applied).toEqual(["0.38.0"]);
    t.state.applyError = null;
    await t.auto.checked();
    expect(t.applied).toEqual(["0.38.0", "0.38.0"]);
    expect(t.auto.status().state).toBe("started");
  });

  test("a newer version than the one that failed is tried at once", async () => {
    const t = setup();
    t.state.applyError = new Error("boom");
    await t.auto.tick();
    t.state.applyError = null;
    t.state.latest = manifest("0.38.1");
    await t.auto.tick();
    expect(t.applied).toEqual(["0.38.0", "0.38.1"]);
  });

  test("a look while an apply is in flight does nothing", async () => {
    const t = setup();
    const first = t.auto.tick();
    const second = t.auto.tick();
    await Promise.all([first, second]);
    expect(t.applied).toEqual(["0.38.0"]);
  });

  test("stop cancels the wait", async () => {
    const t = setup({ idle: false });
    await t.auto.tick();
    t.auto.stop();
    expect(t.waiting()).toEqual([]);
  });
});
