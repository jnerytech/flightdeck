import { describe, expect, test } from "bun:test";
import { AppStore } from "../src/lib/app-store.ts";
import { memoryPlatform } from "./fixtures.ts";

const quota = (utilization: number) => ({
  pauseAt: null,
  windows: [
    {
      window: "five_hour",
      utilization,
      status: "allowed",
      resetsAt: null,
      readAt: "2026-11-06T12:00:00.000Z",
    },
  ],
});

describe("status-bar-store: the quota is asked again (issue #491)", () => {
  test("refreshQuota asks each online host, keeps what an unanswering host had, and leaves offline hosts alone", async () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    const internals = store as unknown as { update(patch: object): void };
    internals.update({
      hosts: [
        { id: "a", name: "alfa", status: "online", sessions: [] },
        { id: "b", name: "beta", status: "online", sessions: [] },
        { id: "c", name: "gama", status: "offline", sessions: [] },
      ],
      quota: { b: quota(0.2) },
    });
    const asked: string[] = [];
    store.hostCommand = (async (hostId: string, type: string) => {
      asked.push(`${hostId}:${type}`);
      if (hostId === "b") throw new Error("no answer");
      return quota(0.7);
    }) as never;
    await store.refreshQuota();
    expect(asked.sort()).toEqual(["a:quota.get", "b:quota.get"]);
    expect(store.getState().quota.a?.windows[0]?.utilization).toBe(0.7);
    expect(store.getState().quota.b?.windows[0]?.utilization).toBe(0.2);
    expect(store.getState().quota.c).toBeUndefined();
    store.dispose();
  });
});
