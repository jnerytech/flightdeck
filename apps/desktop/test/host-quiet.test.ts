import { describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { hostQuiet, WaitTimeout } from "./wait.ts";

registerDom();

/**
 * A host whose in-flight count follows `counts` one poll at a time (the last one stays), and whose
 * `host.info` answers after a real delay, so an early return shows as an answer not yet given.
 */
function fakeHost(counts: number[]) {
  const polls: number[] = [];
  const state = { asked: [] as number[], answered: 0 };
  const host = {
    hostInFlight: () => {
      const next = counts.length > 1 ? (counts.shift() as number) : (counts[0] as number);
      polls.push(next);
      return next;
    },
    hostRequest: async (_hostId: string, _type: "host.info", _payload: Record<string, never>) => {
      state.asked.push(polls.length);
      await Bun.sleep(30);
      state.answered++;
      return {};
    },
  };
  return { host, state, polls };
}

describe("hostQuiet: the host has nothing left on its way back", () => {
  test("it asks nothing while requests are in flight, and asks once they are all answered", async () => {
    const { host, state, polls } = fakeHost([2, 2, 1, 0]);
    await hostQuiet(host, "h1");
    expect([polls.slice(0, state.asked[0]), state.asked.length]).toEqual([[2, 2, 1, 0], 1]);
  });

  test("it returns only after the last question was answered, not when it was sent", async () => {
    const { host, state } = fakeHost([0]);
    await hostQuiet(host, "h1");
    expect(state.answered).toBe(1);
  });

  test("a request that the last question left in flight is waited for and asked after", async () => {
    const { host, state } = fakeHost([0, 1, 0]);
    await hostQuiet(host, "h1");
    expect([state.asked.length, state.answered]).toEqual([2, 2]);
  });

  test("a host that never goes quiet throws, with what it waited for", async () => {
    const { host } = fakeHost([1]);
    const error = await hostQuiet(host, "h1", 60).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WaitTimeout);
    expect((error as Error).message).toContain("requests in flight");
  });
});
