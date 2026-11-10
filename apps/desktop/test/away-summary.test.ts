import { describe, expect, test } from "bun:test";
import type { ActivitySinceResult } from "@flightdeck/protocol";
import type { AwayState } from "../src/features/activity/index.ts";
import { awayView } from "../src/features/activity/index.ts";

const SINCE = "2026-11-09T00:00:00.000Z";
const list = <T>(items: T[], total = items.length) => ({ items, total });
const result = (over: Partial<ActivitySinceResult> = {}): ActivitySinceResult => ({
  since: SINCE,
  sessions: list([]),
  reviewCards: list([]),
  prs: list([]),
  failedRuns: list([]),
  quota: [{ window: "five_hour", utilization: 0.4 }],
  ...over,
});
const session = { id: "s1", name: "Fix login", cwd: "/r", at: "2026-11-09T02:00:00.000Z" };
const hosts = [
  { id: "h1", name: "alfa" },
  { id: "h2", name: "beta" },
];
const away = (over: object = {}) =>
  ({ since: SINCE, hosts: [], dismissed: false, unreached: [], ...over }) as AwayState;

describe("away-summary: what the hosts say happened while the app was closed (#1344)", () => {
  test("lists the hosts that have news, in the order they answered, with their names", () => {
    const view = awayView(
      away({
        hosts: [
          { hostId: "h2", result: result({ sessions: list([session]) }) },
          { hostId: "h1", result: result({ failedRuns: list([{ runId: "r1" }] as never) }) },
        ],
      }),
      hosts,
    );
    expect(view?.since).toBe(SINCE);
    expect(view?.news.map((n) => n.hostName)).toEqual(["beta", "alfa"]);
  });

  test("a host with nothing new is left out, and its quota alone is not news", () => {
    const view = awayView(
      away({
        hosts: [
          { hostId: "h1", result: result() },
          { hostId: "h2", result: result({ prs: list([], 3) }) },
        ],
      }),
      hosts,
    );
    expect(view?.news.map((n) => n.hostId)).toEqual(["h2"]);
  });

  test("no summary when nothing is new, after a short absence, or once the person closed it", () => {
    const quiet = away({ hosts: [{ hostId: "h1", result: result() }] });
    const busy = away({ hosts: [{ hostId: "h1", result: result({ sessions: list([session]) }) }] });
    expect([
      awayView(quiet, hosts),
      awayView({ ...busy, since: null }, hosts),
      awayView({ ...busy, dismissed: true }, hosts),
    ]).toEqual([null, null, null]);
    expect(awayView(busy, hosts)).not.toBeNull();
  });

  test("a host that did not answer is named, even when no host has news", () => {
    const view = awayView(away({ unreached: ["h2"] }), hosts);
    expect(view?.unreached).toEqual(["beta"]);
    expect(view?.news).toEqual([]);
  });
});
