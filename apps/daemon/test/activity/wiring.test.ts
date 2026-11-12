import { describe, expect, test } from "bun:test";
import type { QuotaWindow } from "@flightdeck/protocol";
import { createActivity } from "../../src/activity/wiring.ts";
import { EventStore } from "../../src/store/event-store.ts";

/** Issue #1344: the module hands the server "while you were away", read from this daemon's store and quota. */
describe("activity-wiring: the module the server takes `activity` from (#1344)", () => {
  test("it answers what happened since a time, with the quota windows now", () => {
    const windows: QuotaWindow[] = [
      {
        window: "five_hour",
        utilization: 0.5,
        status: "allowed",
        resetsAt: null,
        readAt: "2026-11-08T23:00:00.000Z",
      },
    ];
    const { modules } = createActivity({ db: new EventStore(":memory:").db, quota: () => windows });
    const result = modules[0].server?.activity?.("2026-11-08T22:00:00.000Z", 5);
    expect([result?.sessions.total, result?.quota]).toEqual([
      0,
      [{ window: "five_hour", utilization: 0.5 }],
    ]);
  });
});
