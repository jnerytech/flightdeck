import { describe, expect, test } from "bun:test";
import type { AccountState } from "@flightdeck/protocol";
import { Account, type AccountReaders } from "../src/account/account.ts";
import type { AuthStatus } from "../src/account/readers.ts";
import { FlightdeckError } from "../src/errors.ts";
import { Quota, type Timers } from "../src/quota/quota.ts";

const T0 = Date.UTC(2026, 10, 3, 12, 0, 0);
const FIVE_MIN = 5 * 60_000;

const signedIn: AuthStatus = {
  loggedIn: true,
  authMethod: "claude.ai",
  apiProvider: "firstParty",
  email: "demo@example.com",
  organization: null,
  plan: "max",
};

/** A clock and timers that only move when asked. */
function manualTime() {
  let now = T0;
  const pending: Array<{ fn: () => void; at: number; cleared: boolean }> = [];
  const timers: Timers = {
    set: (fn, ms) => {
      const timer = { fn, at: now + ms, cleared: false };
      pending.push(timer);
      return timer;
    },
    clear: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  };
  return {
    timers,
    now: () => now,
    live: () => pending.filter((t) => !t.cleared),
    /** Moves the clock and fires the live timers that came due. */
    async advance(ms: number) {
      now += ms;
      for (const timer of pending.filter((t) => !t.cleared && t.at <= now)) {
        timer.cleared = true;
        timer.fn();
      }
      await tick();
    },
  };
}

/** Lets the promise chains of a read settle. */
const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function setup(options: { failStatus?: () => boolean; gate?: Promise<void> } = {}) {
  const time = manualTime();
  const quota = new Quota({ pauseAt: null, now: time.now, timers: time.timers });
  const reads: number[] = [];
  const readers: AccountReaders = {
    status: async () => {
      reads.push(time.now());
      if (options.gate) await options.gate;
      if (options.failStatus?.())
        throw new FlightdeckError("invalid_state", "down", "account_unavailable");
      return signedIn;
    },
    sdk: async () => ({
      info: null,
      usage: { plan: "max", available: true, windows: [] },
    }),
  };
  const account = new Account({ quota, readers, now: time.now, timers: time.timers });
  const pushes: AccountState[] = [];
  const watch = () => account.watch((state) => pushes.push(state));
  return { account, quota, time, reads, pushes, watch };
}

const timerOf = (time: ReturnType<typeof manualTime>) => time.live().length;

describe("conta-atualizar: when the account is read", () => {
  test("with no watcher nothing is read and no timer is armed", async () => {
    const { time, reads, account } = setup();
    await time.advance(3 * FIVE_MIN);
    expect(reads).toEqual([]);
    expect(timerOf(time)).toBe(0);
    expect(account.state().readAt).toBeNull();
  });

  test("the first watch reads once, a second watcher does not read again", async () => {
    const { time, reads, watch } = setup();
    watch();
    await tick();
    expect(reads.length).toBe(1);
    watch();
    await tick();
    expect(reads.length).toBe(1);
    expect(timerOf(time)).toBe(1);
  });

  test("while watched it reads every 5 minutes, even after a failed read", async () => {
    let fail = false;
    const { time, reads, watch } = setup({ failStatus: () => fail });
    watch();
    await tick();
    await time.advance(FIVE_MIN - 1);
    expect(reads.length).toBe(1);
    await time.advance(1);
    expect(reads.length).toBe(2);
    fail = true;
    await time.advance(FIVE_MIN);
    expect(reads.length).toBe(3);
    await time.advance(FIVE_MIN);
    expect(reads.length).toBe(4);
  });

  test("when the last watcher leaves the timer is cleared and nothing more is read", async () => {
    const { time, reads, watch } = setup();
    const stopA = watch();
    const stopB = watch();
    await tick();
    stopA();
    expect(timerOf(time)).toBe(1);
    stopB();
    expect(timerOf(time)).toBe(0);
    await time.advance(2 * FIVE_MIN);
    expect(reads.length).toBe(1);
    watch();
    await tick();
    expect(reads.length).toBe(2);
  });

  test("a turn end reads when watched and does nothing when not", async () => {
    const { reads, watch, account } = setup();
    account.turnEnded();
    await tick();
    expect(reads.length).toBe(0);
    watch();
    await tick();
    account.turnEnded();
    await tick();
    expect(reads.length).toBe(2);
  });

  test("a read that is running is shared by a turn end, a poll and a refresh", async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const { reads, watch, account } = setup({ gate });
    watch();
    await tick();
    account.turnEnded();
    const refreshed = account.refresh();
    const again = account.refresh();
    open();
    const [a, b] = await Promise.all([refreshed, again]);
    expect(reads.length).toBe(1);
    expect(a).toEqual(b);
  });
});

describe("conta-atualizar: the manual refresh", () => {
  test("is refused under 30 seconds after the last read, with the seconds to wait", async () => {
    const { time, account } = setup();
    await account.refresh();
    await time.advance(10_000);
    let refusal: FlightdeckError | undefined;
    try {
      await account.refresh();
    } catch (error) {
      refusal = error as FlightdeckError;
    }
    expect(refusal?.reason).toBe("account_refresh_too_soon");
    expect(refusal?.params).toEqual({ waitSeconds: 20 });
    expect(refusal?.code).toBe("invalid_state");
  });

  test("is allowed once 30 seconds have passed, and the first one is allowed at once", async () => {
    const { time, account, reads } = setup();
    await account.refresh();
    await time.advance(30_000);
    await account.refresh();
    expect(reads.length).toBe(2);
  });

  test("a refused refresh reads nothing", async () => {
    const { time, account, reads } = setup();
    await account.refresh();
    await time.advance(1_000);
    await account.refresh().catch(() => {});
    expect(reads.length).toBe(1);
  });
});

describe("conta-atualizar: what the watchers get", () => {
  test("one push after each read, and none for the quota changes the read itself makes", async () => {
    const { pushes, watch } = setup();
    watch();
    await tick();
    expect(pushes.length).toBe(1);
    expect(pushes[0]?.status).toBe("signed_in");
  });

  test("a stream reading in the quota pushes the new windows", async () => {
    const { pushes, watch, quota, time } = setup();
    watch();
    await tick();
    quota.record([
      {
        window: "five_hour",
        utilization: 0.7,
        status: "allowed",
        resetsAt: time.now() + 3_600_000,
      },
    ]);
    expect(pushes.length).toBe(2);
    expect(pushes[1]?.windows.map((w) => w.window)).toEqual(["five_hour"]);
  });

  test("a leaving watcher stops getting pushes, and a broken one does not stop the others", async () => {
    const { account, quota, time } = setup();
    const got: number[] = [];
    account.watch(() => {
      throw new Error("broken listener");
    });
    const stop = account.watch(() => got.push(1));
    await tick();
    expect(got.length).toBe(1);
    stop();
    quota.record([
      {
        window: "five_hour",
        utilization: 0.1,
        status: "allowed",
        resetsAt: time.now() + 3_600_000,
      },
    ]);
    expect(got.length).toBe(1);
  });
});
