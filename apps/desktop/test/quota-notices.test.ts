import { describe, expect, test } from "bun:test";
import { AppStore } from "../src/lib/app-store.ts";
import { memoryPlatform } from "./fixtures.ts";

/**
 * Issue #933: the plan quota belongs to the account, not to a host. Hosts that report the same
 * window and reset collapse into one notice, and a notice comes again only for a higher level or
 * after the window resets.
 */
const WEEK = 7 * 24 * 3_600_000;
const RESET = Date.UTC(2026, 10, 12, 18, 0, 0);

const reading = (utilization: number, resetsAt: number, status = "allowed") => ({
  pauseAt: 0.95,
  windows: [
    {
      window: "seven_day",
      utilization,
      status,
      resetsAt: new Date(resetsAt).toISOString(),
      readAt: "2026-11-07T12:00:00.000Z",
    },
  ],
});

/** Three online hosts on one account; `answer` says what each one reports on a poll. */
function hosts(answer: (host: string, poll: number) => unknown) {
  // A clock of its own: a reset in the test is always in the future, whatever day this runs.
  const store = new AppStore(memoryPlatform(false, "en").platform, {
    baseDelayMs: 600_000,
    now: () => RESET - 24 * 3_600_000,
  });
  (store as unknown as { update(patch: object): void }).update({
    hosts: ["a", "b", "c"].map((id) => ({
      id,
      name: `host-${id}`,
      status: "online",
      sessions: [],
    })),
  });
  let poll = 0;
  store.hostCommand = (async (hostId: string) => answer(hostId, poll)) as never;
  const refresh = async () => {
    poll += 1;
    await store.refreshQuota();
  };
  // Only the quota raises a notice here: every bell entry is one.
  const notices = () => store.getState().inbox.length;
  return { store, refresh, notices };
}

describe("quota-notices: one notice per account, window and level (#933)", () => {
  test("three hosts on one account, polled many times at 98%, give one notice, whatever the jitter in the reset", async () => {
    // Each host reports the same reset to within seconds, and the seconds change on every poll.
    const { store, refresh, notices } = hosts((host, poll) =>
      reading(0.98, RESET + (host.charCodeAt(0) + poll) * 1_000),
    );
    for (let i = 0; i < 6; i++) await refresh();
    expect(notices()).toBe(1);
    store.dispose();
  });

  test("a higher level notifies once more, and the same level does not", async () => {
    let utilization = 0.96;
    let status = "allowed";
    const { store, refresh, notices } = hosts(() => reading(utilization, RESET, status));
    await refresh();
    await refresh();
    utilization = 1;
    status = "rejected";
    await refresh();
    await refresh();
    expect(notices()).toBe(2);
    store.dispose();
  });

  test("a window that resets re-arms: the next crossing notifies again", async () => {
    let utilization = 0.97;
    let resetsAt = RESET;
    const { store, refresh, notices } = hosts(() => reading(utilization, resetsAt));
    await refresh();
    // The window ended: a week later, low use.
    utilization = 0.2;
    resetsAt = RESET + WEEK;
    await refresh();
    utilization = 0.97;
    await refresh();
    await refresh();
    expect(notices()).toBe(2);
    store.dispose();
  });

  test("use that drops under the threshold and comes back notifies again", async () => {
    let utilization = 0.97;
    const { store, refresh, notices } = hosts(() => reading(utilization, RESET));
    await refresh();
    utilization = 0.4;
    await refresh();
    utilization = 0.97;
    await refresh();
    expect(notices()).toBe(2);
    store.dispose();
  });

  test("accounts whose windows reset at other times each notify", async () => {
    const { store, refresh, notices } = hosts((host) =>
      reading(0.98, RESET + (host === "c" ? 3 * 24 * 3_600_000 : 0)),
    );
    await refresh();
    await refresh();
    expect(notices()).toBe(2);
    store.dispose();
  });
});
