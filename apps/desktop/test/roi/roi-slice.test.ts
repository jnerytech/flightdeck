import { describe, expect, test } from "bun:test";
import type { RoiSummaryResult } from "@flightdeck/protocol";
import { UNASSIGNED } from "../../src/features/clients/domain/clients.ts";
import { RoiSlice } from "../../src/features/roi/index.ts";
import { RoiSettings } from "../../src/features/roi/roi-settings.ts";
import type { HostResult } from "../../src/lib/app-store.ts";
import { AppStore } from "../../src/lib/app-store.ts";
import { memoryPlatform } from "../fixtures.ts";

const RESULT = { days: [] } as never as RoiSummaryResult;
const host = (id: string, status: string, features: string[]) =>
  ({ id, name: id, status, hostInfo: { features } }) as never;

/** A slice over stand-ins: the hosts, what each answers, the clock and the person's settings. */
function roi(
  over: {
    hosts?: unknown[];
    answers?: Record<string, HostResult<RoiSummaryResult>>;
    now?: number;
    clientOf?: (key: string) => string | null;
  } = {},
) {
  const settings = new RoiSettings(memoryPlatform(false, "en").platform);
  const asked: string[] = [];
  const slice = new RoiSlice({
    hosts: () => (over.hosts ?? []) as never,
    now: () => over.now ?? Date.parse("2026-10-14T12:00:00Z"),
    summary: async (hostId, range) => {
      asked.push(`${hostId}:${range.from}..${range.to}`);
      return over.answers?.[hostId] ?? { ok: true, data: RESULT };
    },
    clientOf: over.clientOf ?? (() => null),
    settings: () => settings,
  });
  return { slice, settings, asked };
}

describe("roi slice", () => {
  test("the figures end on today's UTC day, even when the local day is still yesterday", () => {
    const { slice } = roi({ now: Date.parse("2026-10-14T01:30:00Z") });
    expect(slice.today()).toBe("2026-10-14");
  });

  test("only online hosts with the roi feature are asked, and one that refuses is left out", async () => {
    const { slice, asked } = roi({
      hosts: [
        host("on", "online", ["roi"]),
        host("off", "offline", ["roi"]),
        host("old", "online", []),
        host("bad", "online", ["roi"]),
      ],
      answers: { bad: { ok: false, code: "internal" } as never },
    });
    const all = await slice.summaries("2026-10-01", "2026-10-14");
    expect(all.map((a) => a.hostId)).toEqual(["on"]);
    expect(asked.sort()).toEqual(["bad:2026-10-01..2026-10-14", "on:2026-10-01..2026-10-14"]);
  });

  test("a project's money takes the typed rate of its project, else its client, else the app's, and the review settings", () => {
    const { slice, settings } = roi({ clientOf: (key) => (key === "p-client" ? "c1" : null) });
    settings.setDefaultRate(10);
    settings.setClientRate("c1", 20);
    settings.setProjectRate("p-own", 30);
    settings.setCountReview(true);
    settings.setReviewCap(5);
    expect(slice.moneyOf("p-own")).toMatchObject({
      rate: 30,
      countReview: true,
      reviewCapSeconds: 300,
    });
    expect(slice.moneyOf("p-client").rate).toBe(20);
    expect(slice.moneyOf("p-none")).toMatchObject({ rate: 10, billed: null, planShareUsd: null });
  });

  test("in the app, a project pinned to a client takes the client's rate and an unassigned one the app's, never a rate typed under the Unassigned id", () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    const client = store.clients.add("Acme");
    store.clients.setOverride("pinned", client?.id ?? "");
    store.roi.setDefaultRate(10);
    store.roi.setClientRate(client?.id ?? "", 20);
    store.roi.setClientRate(UNASSIGNED, 99);
    expect([
      store.roiFigures.moneyOf("pinned").rate,
      store.roiFigures.moneyOf("loose").rate,
    ]).toEqual([20, 10]);
  });
});
