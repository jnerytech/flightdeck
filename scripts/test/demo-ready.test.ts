import { describe, expect, test } from "bun:test";
import { type UsageLoad, waitUsageLoaded } from "../lib/demo-ready.ts";

const load = (state: string, filesDone: number): UsageLoad => ({
  state,
  filesDone,
  filesTotal: 98,
});

describe("demo-ready: the seed waits for the usage's first pass", () => {
  test("it waits while the pass is running and returns once it is done", async () => {
    const answers = [load("running", 10), load("running", 60), load("done", 98)];
    let asked = 0;
    await waitUsageLoaded(async () => answers[asked++] ?? load("done", 98), { pollMs: 1 });
    expect(asked).toBe(3);
  });

  test("a host that answers nothing is asked again", async () => {
    const answers = [null, load("done", 98)];
    let asked = 0;
    await waitUsageLoaded(async () => answers[asked++] ?? null, { pollMs: 1 });
    expect(asked).toBe(2);
  });

  test("a pass that does not end in time fails with how far it got", async () => {
    await expect(
      waitUsageLoaded(async () => load("running", 12), { timeoutMs: 30, pollMs: 5 }),
    ).rejects.toThrow('did not end in 30 ms ({"state":"running","filesDone":12,"filesTotal":98})');
  });
});
