import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Budget } from "@flightdeck/protocol";
import { runBudgetCli } from "../../src/costs/index.ts";
import { parseArgs } from "../../src/main.ts";
import { config, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { poll } from "../support/helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const DAY: Budget = {
  id: "b1",
  scope: "host",
  projectKey: null,
  period: "day",
  limitUsd: 5,
  limitPct: null,
  action: "queue",
  createdAt: "2026-11-20T09:00:00Z",
  periodKey: "2026-11-20",
  spentUsd: 4.1,
  spentPct: null,
  estimated: false,
  fraction: 0.82,
  crossed: [0.5, 0.8],
};

const updated = (over: { threshold?: number | null; removed?: boolean } = {}) => ({
  type: "budget.updated",
  budget: DAY,
  threshold: over.threshold ?? null,
  removed: over.removed ?? false,
});

/** Runs `budget watch` once the daemon has it, then presses Ctrl-C when `lines` lines came. */
async function watched(
  daemon: ReturnType<typeof fakeDaemon>,
  options: { json?: boolean; timeoutMs?: number; lines?: number; after?: () => unknown } = {},
) {
  const lines: string[] = [];
  const stop = new AbortController();
  const running = runBudgetCli(
    { action: "watch", ...(options.json ? { json: true } : {}) },
    config(daemon.port),
    { timeoutMs: options.timeoutMs ?? 2000, signal: stop.signal, write: (l) => lines.push(l) },
  );
  await poll(() => daemon.calls.some((c) => c.type === "budget.watch"));
  await options.after?.();
  await poll(() => lines.length >= (options.lines ?? 1));
  stop.abort();
  return { result: await running, lines };
}

describe("flightdeckd budget watch (issue #3460)", () => {
  test("it writes a line for each change, says a crossed threshold and a removal, and Ctrl-C ends it with 0", async () => {
    const daemon = fakeDaemon({ "budget.watch": () => ({}) });
    const { result, lines } = await watched(daemon, {
      lines: 3,
      after: () => {
        daemon.push(updated());
        daemon.push(updated({ threshold: 0.8 }));
        daemon.push(updated({ removed: true }));
      },
    });
    expect(lines).toEqual([
      "b1  host  day  spent $4.10 of $5.00 (82%)  queue",
      "b1  host  day  spent $4.10 of $5.00 (82%)  queue  crossed 80%",
      "b1  host  day  spent $4.10 of $5.00 (82%)  queue  removed",
    ]);
    expect(result.code).toBe(0);
    expect(daemon.calls.filter((c) => c.type === "budget.watch")).toHaveLength(1);
  });

  test("--json writes the budget, the threshold and the removal of each change on one line", async () => {
    const daemon = fakeDaemon({ "budget.watch": () => ({}) });
    const { lines } = await watched(daemon, {
      json: true,
      after: () => daemon.push(updated({ threshold: 0.5 })),
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({ budget: DAY, threshold: 0.5, removed: false });
  });

  test("a refused watch exits 1 with the daemon's code", async () => {
    const daemon = fakeDaemon({
      "budget.watch": () => ({ error: { code: "invalid", message: "nope" } }),
    });
    const { result } = await watched(daemon, { lines: 0 });
    expect(result.code).toBe(1);
    expect([...result.out, ...result.err].join("\n")).toContain("nope");
  });

  test("a daemon that never acks the watch exits 2 without saying the budgets may have changed", async () => {
    const silent = fakeDaemon({ "budget.watch": () => undefined });
    const result = await runBudgetCli({ action: "watch" }, config(silent.port), {
      timeoutMs: 300,
      signal: new AbortController().signal,
      write: () => undefined,
    });
    expect(result.code).toBe(2);
    expect([...result.out, ...result.err].join("\n")).not.toContain("may or may not");
  });
});

describe("the arguments of budget watch (issue #3460)", () => {
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("budget watch is read as that verb, with --json for a script", () => {
    expect(parsed(["budget", "watch"])).toMatchObject({ command: "budget", action: "watch" });
    expect(parsed(["budget", "watch", "--json"])).toMatchObject({ action: "watch", json: true });
  });

  test("a flag of set is refused on a watch before anything is sent", () => {
    expect(JSON.stringify(parsed(["budget", "watch", "--period", "day"]))).toContain(
      "--period: this flag only applies to flightdeckd budget set",
    );
  });
});
