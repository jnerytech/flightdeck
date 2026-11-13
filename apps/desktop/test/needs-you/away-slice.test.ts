import { describe, expect, test } from "bun:test";
import type { ActivitySinceResult } from "@flightdeck/protocol";
import {
  type ActivityCore,
  ActivitySlice,
  initialActivityState,
} from "../../src/features/activity/index.ts";
import { settlePlain } from "../wait.ts";

const SINCE = "2026-11-09T00:00:00.000Z";
const RESULT = { sessions: { total: 1, items: [] } } as unknown as ActivitySinceResult;

type Answer = { ok: true; data: ActivitySinceResult } | { ok: false };

/**
 * A slice over a bare state: each `request` waits until the test answers it, in the order asked, so a
 * host can reconnect (`loadAway` again) while its first request is still in flight.
 */
function slice() {
  let state = {
    ...initialActivityState(),
    hosts: [{ id: "h1", status: "online", hostInfo: { features: ["activity"] } }],
  };
  const pending: Array<(answer: Answer) => void> = [];
  const core: ActivityCore = {
    state: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    since: () => SINCE,
    request: () => new Promise<Answer>((resolve) => pending.push(resolve)),
  };
  return {
    activity: new ActivitySlice(core),
    away: () => state.away,
    setStatus: (status: string) => {
      state = { ...state, hosts: state.hosts.map((h) => ({ ...h, status })) };
    },
    asked: () => pending.length,
    answer: (index: number, answer: Answer) => pending[index]?.(answer),
  };
}

describe("away slice: what happened on the hosts while the app was away (#1709)", () => {
  test("a host that reconnects while its request is in flight is asked again, and ends answered, not unreached", async () => {
    const s = slice();
    const first = s.activity.loadAway();
    await settlePlain(() => s.asked() === 1);
    // The host reconnects: its info arrives again and asks again while the first request is on its way.
    await s.activity.loadAway();
    s.answer(0, { ok: false });
    await settlePlain(() => s.asked() === 2);
    s.answer(1, { ok: true, data: RESULT });
    await first;
    expect(s.away().hosts.map((h) => h.hostId)).toEqual(["h1"]);
    expect(s.away().unreached).toEqual([]);
  });

  test("a host whose request fails with no reconnect in between is named unreached, and asked again on its next connect", async () => {
    const s = slice();
    const first = s.activity.loadAway();
    await settlePlain(() => s.asked() === 1);
    s.answer(0, { ok: false });
    await first;
    expect(s.away().unreached).toEqual(["h1"]);
    expect(s.asked()).toBe(1);
    const again = s.activity.loadAway();
    await settlePlain(() => s.asked() === 2);
    s.answer(1, { ok: true, data: RESULT });
    await again;
    expect(s.away().hosts.map((h) => h.hostId)).toEqual(["h1"]);
    expect(s.away().unreached).toEqual([]);
  });

  test("a host that reconnects while its request is in flight is not asked twice when the first answers", async () => {
    const s = slice();
    const first = s.activity.loadAway();
    await settlePlain(() => s.asked() === 1);
    await s.activity.loadAway();
    s.answer(0, { ok: true, data: RESULT });
    await first;
    expect(s.asked()).toBe(1);
    expect(s.away().hosts.map((h) => h.hostId)).toEqual(["h1"]);
  });

  test("a host that went offline while its request was in flight and failed is named unreached, not dropped", async () => {
    const s = slice();
    const first = s.activity.loadAway();
    await settlePlain(() => s.asked() === 1);
    await s.activity.loadAway();
    s.setStatus("offline");
    s.answer(0, { ok: false });
    await first;
    expect(s.away().unreached).toEqual(["h1"]);
    expect(s.asked()).toBe(1);
  });

  test("a removed host leaves the summary, and is asked again if it is added back", async () => {
    const s = slice();
    const first = s.activity.loadAway();
    await settlePlain(() => s.asked() === 1);
    s.answer(0, { ok: true, data: RESULT });
    await first;
    expect(s.away().hosts.map((h) => h.hostId)).toEqual(["h1"]);
    s.activity.forget("h1");
    expect(s.away().hosts).toEqual([]);
    expect(s.away().unreached).toEqual([]);
    const again = s.activity.loadAway();
    await settlePlain(() => s.asked() === 2);
    s.answer(1, { ok: true, data: RESULT });
    await again;
    expect(s.away().hosts.map((h) => h.hostId)).toEqual(["h1"]);
  });

  test("an answer that arrives after its host was removed is not added to the summary", async () => {
    const s = slice();
    const first = s.activity.loadAway();
    await settlePlain(() => s.asked() === 1);
    s.activity.forget("h1");
    s.answer(0, { ok: true, data: RESULT });
    await first;
    expect(s.away().hosts).toEqual([]);
    expect(s.away().unreached).toEqual([]);
  });
});
