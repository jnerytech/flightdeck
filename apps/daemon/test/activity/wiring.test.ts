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
    const db = new EventStore(":memory:").db;
    const ended = (id: string, at: string) =>
      db
        .query(
          "INSERT INTO sessions (id, name, cwd, status, permission_mode, created_at, updated_at) VALUES (?, NULL, '/r', 'ended', 'default', ?, ?)",
        )
        .run(id, "2026-11-08T21:00:00.000Z", at);
    ended("after", "2026-11-08T23:00:00.000Z");
    ended("before", "2026-11-08T21:30:00.000Z");
    const { modules } = createActivity({ db, quota: () => windows });
    const result = modules[0].server?.activity?.("2026-11-08T22:00:00.000Z", 5);
    expect([result?.sessions.items.map((s) => s.id), result?.quota]).toEqual([
      ["after"],
      [{ window: "five_hour", utilization: 0.5 }],
    ]);
  });
});
