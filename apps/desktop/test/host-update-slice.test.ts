import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { UpdateStatus } from "@flightdeck/protocol";
import {
  type HostUpdateCore,
  type HostUpdatePatch,
  HostUpdateSlice,
  type HostUpdateView,
} from "../src/features/hosts/index.ts";
import { APP_VERSION } from "../src/lib/version.ts";

/** The timers the slice started and not yet fired: the test fires them, so no test waits. */
let timers: Array<() => void> = [];
const realSetTimeout = globalThis.setTimeout;
beforeEach(() => {
  timers = [];
  globalThis.setTimeout = ((fn: () => void) => {
    timers.push(fn);
    return 0;
  }) as unknown as typeof setTimeout;
});
afterEach(() => {
  globalThis.setTimeout = realSetTimeout;
});

const STATUS = { version: "9.9.9" } as unknown as UpdateStatus;

/** A slice over one host, online and with an update on offer; the daemon answers as told. */
function slice(
  over: {
    applies?: () => Promise<unknown>;
    checks?: () => Promise<UpdateStatus>;
    daemon?: string;
    connected?: boolean;
    update?: boolean;
  } = {},
) {
  let host: HostUpdateView = {
    status: "online",
    hostInfo: {
      daemonVersion: over.daemon ?? "0.0.1",
      ...(over.update === false ? {} : { update: STATUS }),
    } as never,
    daemonUpdate: null,
    updateCheck: null,
  };
  let clock = 0;
  let checks = 0;
  const core: HostUpdateCore = {
    host: () => host,
    patch: (_id, patch: HostUpdatePatch) => {
      host = { ...host, ...patch };
    },
    connected: () => over.connected ?? true,
    apply: over.applies ?? (async () => ({ started: true })),
    check: async () => {
      checks += 1;
      return (over.checks ?? (async () => STATUS))();
    },
    describeError: (error) => `described: ${String(error)}`,
    t: () => ((key: string, vars?: { version?: string }) => `${key} ${vars?.version}`) as never,
    now: () => clock,
    timeoutMs: 5,
  };
  return {
    updates: new HostUpdateSlice(core),
    host: () => host,
    setTarget: (version: string) => {
      host = { ...host, daemonUpdate: { target: version, failed: null } };
    },
    checks: () => checks,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

describe("host update slice: a daemon's update", () => {
  test("apply marks the update on its target, and says the host is late when it never comes back", async () => {
    const s = slice();
    await s.updates.apply("h1");
    expect(s.host().daemonUpdate).toEqual({ target: "9.9.9", failed: null });
    expect(timers).toHaveLength(1);
    timers[0]?.();
    expect(s.host().daemonUpdate?.failed).toBe("messages.daemonUpdateLate 9.9.9");
  });

  test("a refusal is shown at once, and no late mark follows it", async () => {
    const s = slice({
      applies: async () => {
        throw new Error("refused");
      },
    });
    await s.updates.apply("h1");
    expect(s.host().daemonUpdate).toEqual({ target: "9.9.9", failed: "refused" });
    expect(timers).toHaveLength(0);
  });

  test("a check keeps the daemon's answer, and a failed one names why", async () => {
    const ok = slice();
    await ok.updates.check("h1");
    expect(ok.host().updateCheck).toBeNull();
    const bad = slice({
      checks: async () => {
        throw new Error("offline");
      },
    });
    await bad.updates.check("h1");
    expect(bad.host().updateCheck).toEqual({ busy: false, failed: "described: Error: offline" });
  });

  test("the automatic check runs once per ten minutes, and only when the app is newer than the daemon", async () => {
    const newer = slice({ daemon: "0.0.1" });
    await newer.updates.autoCheck("h1");
    newer.tick(60_000);
    await newer.updates.autoCheck("h1");
    expect(newer.checks()).toBe(1);
    newer.tick(10 * 60_000);
    await newer.updates.autoCheck("h1");
    expect(newer.checks()).toBe(2);
    const same = slice({ daemon: APP_VERSION });
    await same.updates.autoCheck("h1");
    expect(same.checks()).toBe(0);
  });

  test("a host with no connection, or no update on offer, is left alone", async () => {
    const offline = slice({ connected: false });
    await offline.updates.apply("h1");
    await offline.updates.check("h1");
    expect(offline.host().daemonUpdate).toBeNull();
    expect(offline.host().updateCheck).toBeNull();
    expect(offline.checks()).toBe(0);
    const bare = slice({ update: false });
    await bare.updates.apply("h1");
    expect(bare.host().daemonUpdate).toBeNull();
    expect(timers).toHaveLength(0);
  });

  test("a late mark of an older update never overwrites a newer one", async () => {
    const s = slice();
    await s.updates.apply("h1");
    s.setTarget("10.0.0");
    timers[0]?.();
    expect(s.host().daemonUpdate).toEqual({ target: "10.0.0", failed: null });
  });
});
