import { describe, expect, test } from "bun:test";
import type { QuotaState } from "@flightdeck/protocol";
import {
  initialQuotaState,
  type QuotaCore,
  type QuotaNotice,
  QuotaSlice,
} from "../src/features/quota/index.ts";
import type { T } from "../src/i18n/index.ts";

const RESET = Date.UTC(2026, 10, 12, 18, 0, 0);

const reading = (utilization: number, pauseAt: number | null = 0.9): QuotaState => ({
  pauseAt,
  windows: [
    {
      window: "seven_day",
      utilization,
      status: "allowed",
      resetsAt: new Date(RESET).toISOString(),
      readAt: "2026-11-07T12:00:00.000Z",
    },
  ],
});

/** A stand-in dictionary: the key and the values it was given, so a test sees what the slice asked for. */
const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key} ${JSON.stringify(values)}` : key) as unknown as T;

/**
 * A slice over a bare state. `answers` says what each host reports (a missing host does not answer),
 * and `names` which hosts the app still lists.
 */
function slice(answers: Record<string, QuotaState | null>, names: Record<string, string> = {}) {
  let state = initialQuotaState();
  const told: Array<{ notice: QuotaNotice; hostId: string }> = [];
  const asked: string[] = [];
  const core: QuotaCore = {
    state: () => state,
    update: (patch) => {
      state = { ...state, ...patch };
    },
    onlineHosts: () => Object.keys(answers),
    hostName: (hostId) => names[hostId],
    read: async (hostId) => {
      asked.push(hostId);
      return answers[hostId] ?? null;
    },
    setPauseAt: async (hostId, pauseAt) => {
      const held = answers[hostId];
      return held ? { ...held, pauseAt } : null;
    },
    notify: (notice, hostId) => {
      told.push({ notice, hostId });
    },
    t: () => t,
    now: () => RESET - 24 * 3_600_000,
  };
  return { quota: new QuotaSlice(core), state: () => state, told, asked };
}

describe("quota slice: a host's plan usage", () => {
  test("refresh keeps what each answering host reported, and what a silent host had", async () => {
    const s = slice({ a: reading(0.5), b: null }, { a: "alfa", b: "beta" });
    s.quota.updated("b", reading(0.2));
    await s.quota.refresh();
    expect(s.asked).toEqual(["a", "b"]);
    expect(s.state().quota).toEqual({ a: reading(0.5), b: reading(0.2) });
  });

  test("updated tells once for a level, again for a higher one, with the host's name and the percent", async () => {
    const s = slice({}, { a: "alfa" });
    s.quota.updated("a", reading(0.91));
    s.quota.updated("a", reading(0.92));
    expect(s.told.map((x) => x.hostId)).toEqual(["a"]);
    expect(s.told[0]?.notice.body).toContain('"host":"alfa"');
    expect(s.told[0]?.notice.body).toContain('"percent":91');
    s.quota.updated("a", reading(0.96));
    expect(s.told).toHaveLength(2);
  });

  test("updated keeps the reading but tells nothing for a host the app no longer lists", () => {
    const s = slice({}, {});
    s.quota.updated("gone", reading(0.99));
    expect(s.told).toEqual([]);
    expect(s.state().quota.gone).toEqual(reading(0.99));
  });

  test("setPause keeps the host's new state, and a refusal leaves the guard as it was", async () => {
    const s = slice({ a: reading(0.5), b: null }, { a: "alfa", b: "beta" });
    await s.quota.setPause("a", 0.8);
    expect(s.state().quota.a?.pauseAt).toBe(0.8);
    s.quota.updated("b", reading(0.2, 0.9));
    await s.quota.setPause("b", 0.7);
    expect(s.state().quota.b?.pauseAt).toBe(0.9);
  });
});
