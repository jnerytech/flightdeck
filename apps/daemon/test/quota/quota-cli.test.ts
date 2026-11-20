import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { QuotaHistory, QuotaState, UsageSummary } from "@flightdeck/protocol";
import { runUsageCli, type UsageCliArgs } from "../../src/costs/index.ts";
import { parseArgs } from "../../src/main.ts";
import { type QuotaCliArgs, runQuotaCli } from "../../src/quota/index.ts";
import { config, fakeDaemon, type Handlers, stopAll, TOKEN } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const STATE: QuotaState = {
  windows: [
    {
      window: "five_hour",
      utilization: 0.42,
      status: "allowed",
      resetsAt: "2026-11-20T15:00:00Z",
      readAt: "2026-11-20T10:00:00Z",
    },
    {
      window: "seven_day",
      utilization: null,
      status: "allowed_warning",
      resetsAt: null,
      readAt: "2026-11-20T10:00:00Z",
    },
  ],
  pauseAt: 0.8,
};

const HISTORY: QuotaHistory = {
  window: "five_hour",
  hours: 24,
  samples: [0.1, 0.2, 0.3].map((utilization, i) => ({
    utilization,
    status: "allowed",
    resetsAt: "2026-11-20T15:00:00Z",
    takenAt: `2026-11-20T1${i}:00:00Z`,
  })),
  projection: { exhaustsAt: "2026-11-20T14:00:00Z", resetsAt: "2026-11-20T15:00:00Z", samples: 3 },
  consumers: [{ projectKey: "flightdeck", costUsd: 1.5, share: 0.75 }],
};

const USAGE: UsageSummary = {
  days: 7,
  rows: [
    {
      day: "2026-11-20",
      projectKey: "flightdeck",
      costUsd: 1.234,
      inputTokens: 1000,
      outputTokens: 500,
      turns: 4,
    },
  ],
};

const HANDLERS: Handlers = {
  "quota.get": () => STATE,
  "quota.history": () => HISTORY,
  "quota.setPauseAt": (payload) => ({
    ...STATE,
    pauseAt: (payload as { pauseAt: number | null }).pauseAt,
  }),
  "usage.summary": () => USAGE,
};

const text = (r: { out: string[]; err: string[] }) => [...r.out, ...r.err].join("\n");
const sent = (daemon: { calls: Array<{ type: string; payload: unknown }> }, type: string) =>
  daemon.calls.find((call) => call.type === type)?.payload;
const quota = (args: QuotaCliArgs, daemon: { port: number }, timeoutMs?: number) =>
  runQuotaCli(args, config(daemon.port), timeoutMs ? { timeoutMs } : {});
const usage = (args: UsageCliArgs, daemon: { port: number }, timeoutMs?: number) =>
  runUsageCli(args, config(daemon.port), timeoutMs ? { timeoutMs } : {});

function parsed(argv: string[]) {
  try {
    return parseArgs(argv);
  } catch (error) {
    return { error: (error as Error).message };
  }
}

describe("quota get (issue #3460)", () => {
  test("says each window and the guard, one line each", async () => {
    const result = await quota({ action: "get" }, fakeDaemon(HANDLERS));
    expect({ code: result.code, out: result.out }).toEqual({
      code: 0,
      out: [
        "five_hour  42%  allowed  resets 2026-11-20T15:00:00Z",
        "seven_day  unknown  allowed_warning",
        "new cards wait from 80%",
      ],
    });
  });

  test("says so when there is no reading and the guard is off", async () => {
    const daemon = fakeDaemon({ "quota.get": () => ({ windows: [], pauseAt: null }) });
    const result = await quota({ action: "get" }, daemon);
    expect(result.out).toEqual(["no quota reading yet", "the quota guard is off"]);
  });

  test("--json prints the daemon's answer", async () => {
    const result = await quota({ action: "get", json: true }, fakeDaemon(HANDLERS));
    expect(result.out).toEqual([JSON.stringify(STATE, null, 2)]);
  });

  test("no answer is exit 2, and a read says nothing of a write", async () => {
    const result = await quota({ action: "get" }, fakeDaemon({}), 200);
    expect(result.code).toBe(2);
    expect(text(result)).not.toContain("may or may not");
  });

  test("the token of the config is in none of the output", async () => {
    const result = await quota({ action: "get" }, fakeDaemon(HANDLERS));
    expect(text(result)).not.toContain(TOKEN);
  });
});

describe("quota history (issue #3460)", () => {
  test("asks for 24 hours when none are given, and says samples, projection and consumers", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await quota({ action: "history", window: "five_hour" }, daemon);
    expect({ code: result.code, out: result.out, sent: sent(daemon, "quota.history") }).toEqual({
      code: 0,
      out: [
        "five_hour, last 24 h: 3 samples",
        "reaches 100% at 2026-11-20T14:00:00Z (resets 2026-11-20T15:00:00Z)",
        "flightdeck  $1.50  75%",
      ],
      sent: { window: "five_hour", hours: 24 },
    });
  });

  test("--hours is sent as given", async () => {
    const daemon = fakeDaemon(HANDLERS);
    await quota({ action: "history", window: "seven_day", hours: 48 }, daemon);
    expect(sent(daemon, "quota.history")).toEqual({ window: "seven_day", hours: 48 });
  });

  test("a window that does not reach 100% before its reset, and one with too few samples, say so", async () => {
    const calm = fakeDaemon({
      "quota.history": () => ({
        ...HISTORY,
        projection: { exhaustsAt: null, resetsAt: "2026-11-20T15:00:00Z", samples: 5 },
        consumers: [],
      }),
    });
    expect((await quota({ action: "history", window: "five_hour" }, calm)).out).toContain(
      "does not reach 100% before it resets",
    );
    const few = fakeDaemon({ "quota.history": () => ({ ...HISTORY, projection: null }) });
    expect((await quota({ action: "history", window: "five_hour" }, few)).out).toContain(
      "no projection yet: it needs 3 samples of the window",
    );
  });

  test("a projection whose window has no known reset says when it runs out and not 'resets null'", async () => {
    const daemon = fakeDaemon({
      "quota.history": () => ({
        ...HISTORY,
        projection: { exhaustsAt: "2026-11-20T14:00:00Z", resetsAt: null, samples: 3 },
      }),
    });
    expect((await quota({ action: "history", window: "five_hour" }, daemon)).out).toContain(
      "reaches 100% at 2026-11-20T14:00:00Z",
    );
  });

  test("--json prints the daemon's answer", async () => {
    const result = await quota(
      { action: "history", window: "five_hour", json: true },
      fakeDaemon(HANDLERS),
    );
    expect(result.out).toEqual([JSON.stringify(HISTORY, null, 2)]);
  });

  test("the daemon's refusal is exit 1 with its reason", async () => {
    const daemon = fakeDaemon({
      "quota.history": () => ({ error: { code: "invalid", message: "no such window" } }),
    });
    const result = await quota({ action: "history", window: "x" }, daemon);
    expect(result.code).toBe(1);
    expect(text(result)).toContain("no such window");
  });
});

describe("quota pause-at (issue #3460)", () => {
  test("a share from 0 to 1 is sent as it is and said as a percent", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await quota({ action: "pause-at", pauseAt: 0.8 }, daemon);
    expect({ code: result.code, out: result.out, sent: sent(daemon, "quota.setPauseAt") }).toEqual({
      code: 0,
      out: ["new cards wait from 80%"],
      sent: { pauseAt: 0.8 },
    });
  });

  test("off sends null and says the guard is off", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await quota({ action: "pause-at", pauseAt: null }, daemon);
    expect({ out: result.out, sent: sent(daemon, "quota.setPauseAt") }).toEqual({
      out: ["the quota guard is off"],
      sent: { pauseAt: null },
    });
  });

  test("--json prints the new state", async () => {
    const result = await quota(
      { action: "pause-at", pauseAt: 0.5, json: true },
      fakeDaemon(HANDLERS),
    );
    expect(result.out).toEqual([JSON.stringify({ ...STATE, pauseAt: 0.5 }, null, 2)]);
  });

  test("a change that got no answer says its result is unknown", async () => {
    const result = await quota({ action: "pause-at", pauseAt: 0.8 }, fakeDaemon({}), 200);
    expect(result.code).toBe(2);
    expect(text(result)).toContain("may or may not have changed");
    expect(text(result)).toContain("quota get");
  });
});

describe("usage (issue #3460)", () => {
  test("asks for the daemon's default days when none are given, one line per row", async () => {
    const daemon = fakeDaemon(HANDLERS);
    const result = await usage({}, daemon);
    expect({ code: result.code, out: result.out, sent: sent(daemon, "usage.summary") }).toEqual({
      code: 0,
      out: ["last 7 days", "2026-11-20  flightdeck  $1.23  1000 in, 500 out  4 turns"],
      sent: {},
    });
  });

  test("--days is sent as given", async () => {
    const daemon = fakeDaemon(HANDLERS);
    await usage({ days: 30 }, daemon);
    expect(sent(daemon, "usage.summary")).toEqual({ days: 30 });
  });

  test("no rows is said, not printed as nothing", async () => {
    const daemon = fakeDaemon({ "usage.summary": () => ({ days: 7, rows: [] }) });
    expect((await usage({}, daemon)).out).toEqual(["last 7 days", "no usage in that time"]);
  });

  test("--json prints the daemon's answer", async () => {
    const result = await usage({ json: true }, fakeDaemon(HANDLERS));
    expect(result.out).toEqual([JSON.stringify(USAGE, null, 2)]);
  });

  test("no answer is exit 2", async () => {
    expect((await usage({}, fakeDaemon({}), 200)).code).toBe(2);
  });
});

describe("flightdeckd quota and usage, as the terminal runs them (issue #3460)", () => {
  async function terminal(argv: string[]) {
    const daemon = fakeDaemon(HANDLERS);
    try {
      return { ...(await flightdeckd(argv, daemon.port)), daemon };
    } catch (error) {
      return { out: [], err: [String(error)], code: -1, daemon };
    }
  }

  test("each command reaches the daemon with its payload and exits 0", async () => {
    const get = await terminal(["quota", "get", "--json"]);
    expect([get.code, sent(get.daemon, "quota.get")]).toEqual([0, {}]);
    const history = await terminal(["quota", "history", "five_hour", "--hours", "48"]);
    expect([history.code, sent(history.daemon, "quota.history")]).toEqual([
      0,
      { window: "five_hour", hours: 48 },
    ]);
    const pause = await terminal(["quota", "pause-at", "0.8"]);
    expect([pause.code, sent(pause.daemon, "quota.setPauseAt")]).toEqual([0, { pauseAt: 0.8 }]);
    const used = await terminal(["usage", "--days", "7", "--json"]);
    expect([used.code, sent(used.daemon, "usage.summary")]).toEqual([0, { days: 7 }]);
  });

  test("a share outside 0 to 1 is exit 1 and sends nothing", async () => {
    const result = await terminal(["quota", "pause-at", "1.5"]);
    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("pause-at");
    expect(sent(result.daemon, "quota.setPauseAt")).toBeUndefined();
  });
});

describe("quota and usage: the arguments (issue #3460)", () => {
  test("each verb takes its operands and flags", () => {
    expect(parsed(["quota", "get", "--json"])).toMatchObject({
      command: "quota",
      action: "get",
      json: true,
    });
    expect(parsed(["quota", "history", "five_hour", "--hours", "48"])).toMatchObject({
      command: "quota",
      action: "history",
      quotaWindow: "five_hour",
      hours: 48,
    });
    expect(parsed(["quota", "pause-at", "0.8"])).toMatchObject({
      action: "pause-at",
      quotaPauseAt: 0.8,
    });
    expect(parsed(["quota", "pause-at", "off"])).toMatchObject({
      action: "pause-at",
      quotaPauseAt: null,
    });
    expect(parsed(["quota", "pause-at", "0"])).toMatchObject({ quotaPauseAt: 0 });
    expect(parsed(["usage", "--days", "7"])).toMatchObject({ command: "usage", days: 7 });
  });

  test("a missing window or share is refused", () => {
    expect(parsed(["quota", "history"])).toMatchObject({
      error: expect.stringContaining("the window"),
    });
    expect(parsed(["quota", "pause-at"])).toMatchObject({
      error: expect.stringContaining("the share"),
    });
  });

  test("a share is off or a number from 0 to 1, and nothing else", () => {
    for (const bad of ["1.5", "-0.1", "abc", "0x1", "1e0", " ", "80%"])
      expect(parsed(["quota", "pause-at", bad])).toMatchObject({
        error: expect.stringContaining("pause-at"),
      });
  });

  test("--hours is a whole number from 1 to 720 and --days from 1 to 90", () => {
    for (const bad of ["0", "721", "1.5", "x"])
      expect(parsed(["quota", "history", "five_hour", "--hours", bad])).toMatchObject({
        error: expect.stringContaining("--hours"),
      });
    for (const bad of ["0", "91", "1.5", "x"])
      expect(parsed(["usage", "--days", bad])).toMatchObject({
        error: expect.stringContaining("--days"),
      });
  });

  test("a flag belongs to its command only", () => {
    expect(parsed(["quota", "get", "--hours", "5"])).toMatchObject({
      error: expect.stringContaining("this flag only applies to flightdeckd quota history"),
    });
    expect(parsed(["quota", "get", "--days", "5"])).toMatchObject({
      error: expect.stringContaining("this flag only applies to flightdeckd usage"),
    });
    expect(parsed(["usage", "--hours", "5"])).toMatchObject({
      error: expect.stringContaining("this flag only applies to flightdeckd quota history"),
    });
  });
});
