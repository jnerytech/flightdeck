import { describe, expect, test } from "bun:test";
import { hostQuiet, stays, WaitTimeout } from "./wait.ts";

/** A host whose open requests and last question the test drives. */
function fakeHost(open: number) {
  const state = { open, asked: [] as number[], release: () => {} };
  const held = new Promise<void>((done) => {
    state.release = done;
  });
  const host = {
    hostInFlight: () => state.open,
    hostRequest: async (_hostId: string, _type: "host.info", _payload: Record<string, never>) => {
      state.asked.push(state.open);
      await held;
      return {};
    },
  };
  return { host, state };
}

describe("hostQuiet: the host has nothing left on its way back", () => {
  test("it does not return, nor ask, while a request is still in flight", async () => {
    const { host, state } = fakeHost(2);
    let done = false;
    const quiet = hostQuiet(host, "h1").then(() => {
      done = true;
    });
    await stays(() => !done && state.asked.length === 0, 100, "waiting for 2 requests in flight");
    state.open = 1;
    await stays(() => !done && state.asked.length === 0, 100, "waiting for 1 request in flight");
    state.open = 0;
    state.release();
    await quiet;
    expect(state.asked).toEqual([0]);
  });

  test("it returns only after the last question was answered, not when it was sent", async () => {
    const { host, state } = fakeHost(0);
    let done = false;
    const quiet = hostQuiet(host, "h1").then(() => {
      done = true;
    });
    await stays(() => !done, 100, "waiting for the answer of the last question");
    expect(state.asked).toEqual([0]);
    state.release();
    await quiet;
    expect(done).toBe(true);
  });

  test("a host that never goes quiet throws, with what it waited for", async () => {
    const { host } = fakeHost(1);
    const error = await hostQuiet(host, "h1", 60).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WaitTimeout);
    expect((error as Error).message).toContain("requests in flight");
  });
});
