import { describe, expect, test } from "bun:test";
import { ensureOnline, type OnlineProbe } from "../../../scripts/lib/e2e-online.ts";

/** A page whose hosts come online at `onlineAt` ms, or after the first reload when `afterReload`. */
function page(options: { onlineAt?: number; afterReload?: boolean }) {
  let clock = 0;
  let reloads = 0;
  const probe: OnlineProbe = {
    online: async () =>
      options.afterReload
        ? reloads > 0
        : options.onlineAt !== undefined && clock >= options.onlineAt,
    reload: async () => {
      reloads++;
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { probe, reloads: () => reloads, clock: () => clock };
}

describe("e2e-online: the journeys start on online hosts", () => {
  test("hosts that are online at once need no wait and no reload", async () => {
    const { probe, reloads, clock } = page({ onlineAt: 0 });
    expect(await ensureOnline(probe)).toBe("online");
    expect(reloads()).toBe(0);
    expect(clock()).toBe(0);
  });

  test("hosts that come online within the wait are waited for, without a reload", async () => {
    const { probe, reloads } = page({ onlineAt: 3000 });
    expect(await ensureOnline(probe, { waitMs: 8000, pollMs: 500 })).toBe("online");
    expect(reloads()).toBe(0);
  });

  test("hosts still offline after the wait: one reload, then the wait again", async () => {
    const { probe, reloads } = page({ afterReload: true });
    expect(await ensureOnline(probe, { waitMs: 2000, pollMs: 500 })).toBe("reloaded");
    expect(reloads()).toBe(1);
  });

  test("hosts that never come online: one reload only, and it gives up after the second wait", async () => {
    const { probe, reloads, clock } = page({});
    expect(await ensureOnline(probe, { waitMs: 2000, pollMs: 500 })).toBe("gave-up");
    expect(reloads()).toBe(1);
    expect(clock()).toBeGreaterThanOrEqual(4000);
    expect(clock()).toBeLessThan(5000);
  });

  test("the defaults wait 8 s before the reload", async () => {
    const { probe, clock } = page({ afterReload: true });
    await ensureOnline(probe);
    expect(clock()).toBeGreaterThanOrEqual(8000);
    expect(clock()).toBeLessThan(9000);
  });
});
