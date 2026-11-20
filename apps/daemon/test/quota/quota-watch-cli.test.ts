import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { QuotaState } from "@flightdeck/protocol";
import { parseArgs } from "../../src/main.ts";
import { runQuotaCli } from "../../src/quota/index.ts";
import { config, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";
import { poll } from "../support/helpers.ts";

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
  ],
  pauseAt: 0.8,
};

const updated = (state: QuotaState = STATE) => ({ type: "quota.updated", ...state });

/** Runs `quota watch` once the daemon has it, then presses Ctrl-C when `lines` lines came. */
async function watched(
  daemon: ReturnType<typeof fakeDaemon>,
  options: { json?: boolean; timeoutMs?: number; lines?: number; after?: () => unknown } = {},
) {
  const lines: string[] = [];
  const stop = new AbortController();
  const running = runQuotaCli(
    { action: "watch", ...(options.json ? { json: true } : {}) },
    config(daemon.port),
    { timeoutMs: options.timeoutMs ?? 2000, signal: stop.signal, write: (l) => lines.push(l) },
  );
  await poll(() => daemon.calls.some((c) => c.type === "quota.watch"));
  await options.after?.();
  await poll(() => lines.length >= (options.lines ?? 1));
  stop.abort();
  return { result: await running, lines };
}

describe("flightdeckd quota watch (issue #3460)", () => {
  test("it writes one line for each reading the daemon pushes, and Ctrl-C ends it with 0", async () => {
    const daemon = fakeDaemon({ "quota.watch": () => ({}) });
    const { result, lines } = await watched(daemon, {
      lines: 2,
      after: () => {
        daemon.push(updated());
        daemon.push(updated({ windows: [], pauseAt: null }));
      },
    });
    expect(lines).toEqual([
      "five_hour  42%  allowed  resets 2026-11-20T15:00:00Z | new cards wait from 80%",
      "no quota reading yet | the quota guard is off",
    ]);
    expect(result.code).toBe(0);
    expect(daemon.calls.filter((c) => c.type === "quota.watch")).toHaveLength(1);
  });

  test("--json writes the windows and the guard of each reading on one line, with no frame type", async () => {
    const daemon = fakeDaemon({ "quota.watch": () => ({}) });
    const { lines } = await watched(daemon, { json: true, after: () => daemon.push(updated()) });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual(STATE);
  });

  test("the time limit covers the connect and the ack, not the stream", async () => {
    const daemon = fakeDaemon({ "quota.watch": () => ({}) });
    const { result, lines } = await watched(daemon, {
      timeoutMs: 300,
      after: async () => {
        const past = Date.now() + 600;
        await poll(() => Date.now() > past); // longer than the limit of 300 ms
        daemon.push(updated());
      },
    });
    expect(lines).toHaveLength(1);
    expect(result.code).toBe(0);
  });

  test("a refused watch exits 1 with the daemon's code", async () => {
    const daemon = fakeDaemon({
      "quota.watch": () => ({ error: { code: "invalid", message: "nope" } }),
    });
    const { result } = await watched(daemon, { lines: 0 });
    expect(result.code).toBe(1);
    expect([...result.out, ...result.err].join("\n")).toContain("nope");
  });

  test("a daemon that never acks the watch exits 2 in the time limit and writes nothing", async () => {
    const silent = fakeDaemon({ "quota.watch": () => undefined });
    const lines: string[] = [];
    const result = await runQuotaCli({ action: "watch" }, config(silent.port), {
      timeoutMs: 300,
      signal: new AbortController().signal,
      write: (l) => lines.push(l),
    });
    expect(result.code).toBe(2);
    expect(lines).toEqual([]);
  });

  test("a watch is a read: it never marks itself as a write that may have gone in", async () => {
    const silent = fakeDaemon({ "quota.watch": () => undefined });
    const result = await runQuotaCli({ action: "watch" }, config(silent.port), {
      timeoutMs: 300,
      signal: new AbortController().signal,
      write: () => undefined,
    });
    expect([...result.out, ...result.err].join("\n")).not.toContain("may or may not");
  });
});

describe("the arguments of quota watch (issue #3460)", () => {
  const parsed = (argv: string[]) => {
    try {
      return parseArgs(argv);
    } catch (error) {
      return { refusedWith: (error as Error).message };
    }
  };

  test("quota watch is read as that verb, with --json for a script", () => {
    expect(parsed(["quota", "watch"])).toMatchObject({ command: "quota", action: "watch" });
    expect(parsed(["quota", "watch", "--json"])).toMatchObject({ action: "watch", json: true });
  });

  test("a flag of another verb is refused before anything is sent", () => {
    expect(JSON.stringify(parsed(["quota", "watch", "--hours", "2"]))).toContain(
      "--hours: this flag only applies to flightdeckd quota history",
    );
  });
});
