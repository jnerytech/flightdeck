import { describe, expect, test } from "bun:test";
import {
  initialMessagingState,
  type LoopAlert,
  loopPairKey,
  type MessagingCore,
  MessagingSlice,
} from "../src/features/messaging/index.ts";
import { translator } from "../src/i18n/index.ts";

const frame = (from: string, to: string, message = "paused") => ({
  type: "messaging.alert" as const,
  from,
  to,
  message,
  at: "2026-11-10T10:00:00.000Z",
});

/** A slice over a bare state, recording the notifications and the commands it sends. */
function slice(overrides: Partial<Pick<MessagingCore, "rules" | "setRules">> = {}) {
  let state = initialMessagingState();
  const notified: { title: string; body: string }[] = [];
  const sent: { hostId: string; unpause: string[] }[] = [];
  const core: MessagingCore = {
    state: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    rules: async () => ({ policy: { mode: "ask" }, paused: [] }),
    setRules: async (hostId, rules) => {
      sent.push({ hostId, unpause: rules.unpause });
      return { policy: rules.policy, paused: [] };
    },
    notify: (n) => notified.push(n),
    t: () => translator("en"),
    ...overrides,
  };
  return { messaging: new MessagingSlice(core), alerts: () => state.loopAlerts, notified, sent };
}

describe("the messaging slice", () => {
  test("a paused loop waits once per pair, whichever way it was said, and notifies each time", () => {
    const { messaging, alerts, notified } = slice();
    messaging.onLoopAlert("h1", frame("a", "b", "first"));
    messaging.onLoopAlert("h1", frame("b", "a", "again"));
    messaging.onLoopAlert("h2", frame("a", "b"));
    expect(alerts().map((a: LoopAlert) => `${a.hostId}:${a.message}`)).toEqual([
      "h1:again",
      "h2:paused",
    ]);
    expect(notified.map((n) => n.body)).toEqual(["first", "again", "paused"]);
    expect(notified[0]?.title).toBe(translator("en")("needsYou.loopTitle"));
  });

  test("freeing a pair unpauses it on the host with its policy as it is, and drops its entry", async () => {
    const { messaging, alerts, sent } = slice();
    messaging.onLoopAlert("h1", frame("a", "b"));
    messaging.onLoopAlert("h1", frame("c", "d"));
    const key = loopPairKey({ from: "b", to: "a" });
    const done = await messaging.releasePair("h1", key);
    expect(done).toEqual({ policy: { mode: "ask" }, paused: [] });
    expect(sent).toEqual([{ hostId: "h1", unpause: [key] }]);
    expect(alerts().map((a) => `${a.from}>${a.to}`)).toEqual(["c>d"]);
  });

  test("a host that refuses to read or write its rules keeps the entry", async () => {
    const reads = slice({ rules: async () => null });
    reads.messaging.onLoopAlert("h1", frame("a", "b"));
    expect(await reads.messaging.releasePair("h1", "a|b")).toBeNull();
    expect(reads.sent).toEqual([]);
    expect(reads.alerts()).toHaveLength(1);

    const writes = slice({ setRules: async () => null });
    writes.messaging.onLoopAlert("h1", frame("a", "b"));
    expect(await writes.messaging.releasePair("h1", "a|b")).toBeNull();
    expect(writes.alerts()).toHaveLength(1);
  });
});
