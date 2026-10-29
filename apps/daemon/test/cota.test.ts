import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { QuotaUpdated } from "@flightdeck/protocol";
import { Config, loadConfig } from "../src/config.ts";
import { Quota, type Timers } from "../src/quota/quota.ts";
import { normalizeSdkMessage } from "../src/runtime/claude-sdk-runtime.ts";
import { startServer } from "../src/server.ts";
import { newManager, poll, record, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "quota-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The format observed in the PoC (docs/SPEC-fase-7.md), with and without `unifiedWindows`. */
const rateLimit = (info: Record<string, unknown>) =>
  ({
    type: "rate_limit_event",
    rate_limit_info: info,
    uuid: "u",
    session_id: "s",
  }) as unknown as SDKMessage;

/** A clock that only moves by hand and timers that fire only when asked. */
function manualTime(start = Date.UTC(2026, 9, 1, 12, 0, 0)) {
  let now = start;
  const pending: Array<{ fn: () => void; at: number; cleared: boolean }> = [];
  const timers: Timers = {
    set: (fn, ms) => {
      const timer = { fn, at: now + ms, cleared: false };
      pending.push(timer);
      return timer;
    },
    clear: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  };
  /** Moves the clock and fires every timer that came due. */
  const advance = (ms: number) => {
    now += ms;
    for (const timer of pending.splice(0)) {
      if (timer.cleared) continue;
      if (timer.at <= now) timer.fn();
      else pending.push(timer);
    }
  };
  return { now: () => now, timers, advance, pending };
}

describe("cota", () => {
  test("rate_limit_event com unifiedWindows vira uma leitura por janela", () => {
    const events = normalizeSdkMessage(
      rateLimit({
        status: "allowed",
        resetsAt: 1793286000,
        rateLimitType: "five_hour",
        unifiedWindows: {
          five_hour: { utilization: 0.53, resetsAt: 1793286000, status: "allowed" },
          seven_day: { utilization: 0.22, resetsAt: 1793487600, status: "allowed_warning" },
        },
      }),
    );
    expect(events).toEqual([
      {
        type: "quota",
        windows: [
          { window: "five_hour", utilization: 0.53, status: "allowed", resetsAt: 1793286000_000 },
          {
            window: "seven_day",
            utilization: 0.22,
            status: "allowed_warning",
            resetsAt: 1793487600_000,
          },
        ],
      },
    ]);
  });

  test("sem unifiedWindows, a janela vem do topo; o que não se entende fica de fora", () => {
    expect(
      normalizeSdkMessage(
        rateLimit({
          status: "rejected",
          resetsAt: 1793286000,
          rateLimitType: "five_hour",
          utilization: 1,
        }),
      ),
    ).toEqual([
      {
        type: "quota",
        windows: [
          { window: "five_hour", utilization: 1, status: "rejected", resetsAt: 1793286000_000 },
        ],
      },
    ]);
    // Without utilization nor resetsAt: still a reading, with what came.
    expect(
      normalizeSdkMessage(rateLimit({ status: "allowed", rateLimitType: "seven_day" })),
    ).toEqual([
      {
        type: "quota",
        windows: [{ window: "seven_day", utilization: null, status: "allowed", resetsAt: null }],
      },
    ]);
    // No window type, an unknown status or no info at all: nothing to read.
    expect(normalizeSdkMessage(rateLimit({ status: "allowed" }))).toEqual([]);
    expect(
      normalizeSdkMessage(rateLimit({ status: "talvez", rateLimitType: "five_hour" })),
    ).toEqual([]);
    const bare = { type: "rate_limit_event", uuid: "u", session_id: "s" } as unknown as SDKMessage;
    expect(normalizeSdkMessage(bare)).toEqual([]);
    const odd = rateLimit({ unifiedWindows: { five_hour: "x", seven_day: { status: "allowed" } } });
    expect(normalizeSdkMessage(odd)).toEqual([
      {
        type: "quota",
        windows: [{ window: "seven_day", utilization: null, status: "allowed", resetsAt: null }],
      },
    ]);
  });

  test("a cota guarda a última leitura de cada janela e a idade dela", () => {
    const time = manualTime();
    const quota = new Quota({ pauseAt: 0.9, now: time.now, timers: time.timers });
    const resets = time.now() + 3600_000;
    quota.record([{ window: "five_hour", utilization: 0.4, status: "allowed", resetsAt: resets }]);
    time.advance(60_000);
    quota.record([
      { window: "five_hour", utilization: 0.5, status: "allowed", resetsAt: resets },
      { window: "seven_day", utilization: 0.1, status: "allowed", resetsAt: null },
    ]);
    expect(quota.state()).toEqual({
      pauseAt: 0.9,
      windows: [
        {
          window: "five_hour",
          utilization: 0.5,
          status: "allowed",
          resetsAt: new Date(resets).toISOString(),
          readAt: new Date(time.now()).toISOString(),
        },
        {
          window: "seven_day",
          utilization: 0.1,
          status: "allowed",
          resetsAt: null,
          readAt: new Date(time.now()).toISOString(),
        },
      ],
    });
  });

  test("leitura vencida no resetsAt deixa de valer, e quem observa fica sabendo", () => {
    const time = manualTime();
    const quota = new Quota({ pauseAt: null, now: time.now, timers: time.timers });
    const seen: string[][] = [];
    quota.watch((state) => seen.push(state.windows.map((w) => w.window)));
    quota.record([
      { window: "five_hour", utilization: 0.9, status: "allowed", resetsAt: time.now() + 1000 },
      { window: "seven_day", utilization: 0.2, status: "allowed", resetsAt: time.now() + 5000 },
    ]);
    time.advance(999);
    expect(quota.windows().map((w) => w.window)).toEqual(["five_hour", "seven_day"]);
    time.advance(1);
    expect(quota.windows().map((w) => w.window)).toEqual(["seven_day"]);
    time.advance(4000);
    expect(quota.windows()).toEqual([]);
    expect(seen).toEqual([["five_hour", "seven_day"], ["seven_day"], []]);
    // A reading already past its reset never counts; stopping clears the timer.
    quota.record([{ window: "x", utilization: 1, status: "rejected", resetsAt: time.now() - 1 }]);
    expect(quota.windows()).toEqual([]);
    quota.record([{ window: "y", utilization: 1, status: "rejected", resetsAt: time.now() + 10 }]);
    quota.stop();
    expect(time.pending.filter((t) => !t.cleared)).toHaveLength(0);
  });

  test("um watcher que lança não impede os outros", () => {
    const quota = new Quota({ pauseAt: 0.9 });
    const seen: number[] = [];
    quota.watch(() => {
      throw new Error("quebrado");
    });
    const unwatch = quota.watch((state) => seen.push(state.windows.length));
    quota.record([{ window: "five_hour", utilization: 0.1, status: "allowed", resetsAt: null }]);
    unwatch();
    quota.record([{ window: "seven_day", utilization: 0.1, status: "allowed", resetsAt: null }]);
    expect(seen).toEqual([1]);
    quota.stop();
  });

  test("[ratelimit:…] do FakeRuntime numa sessão gerenciada chega à cota e a quota.watch", async () => {
    const quota = new Quota({ pauseAt: 0.9 });
    cleanups.push(() => quota.stop());
    const { manager, project, root } = newManager({
      onQuota: (readings) => quota.record(readings),
    });
    const server = startServer({
      manager,
      quota,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect((await client.request("quota.watch", {})).ok).toBe(true);
    const resets = Math.floor(Date.now() / 1000) + 3600;
    const { sessionId } = manager.create({
      cwd: project,
      prompt: `oi [ratelimit:five_hour=0.95@${resets}]`,
    });
    const frame = await poll(() => client.frames.find((f) => f.type === "quota.updated"), 3000);
    expect(QuotaUpdated.safeParse(frame).success).toBe(true);
    expect(frame).toMatchObject({
      pauseAt: 0.9,
      windows: [
        { window: "five_hour", utilization: 0.95, resetsAt: new Date(resets * 1000).toISOString() },
      ],
    });
    const got = await client.request("quota.get", {});
    expect(got).toMatchObject({
      ok: true,
      data: { windows: [{ window: "five_hour", utilization: 0.95 }] },
    });
    // The host's quota is not a session event: nothing of it is stored nor replayed.
    await poll(() => manager.get(sessionId).status === "idle", 3000);
    expect(
      record(manager, sessionId)
        .events()
        .some((e) => (e.type as string) === "quota"),
    ).toBe(false);
  });

  test("quota.pauseAt na config: padrão 0.9, null desliga, fora de 0 a 1 é recusado", () => {
    const file = join(tempDir(), "config.json");
    writeFileSync(file, JSON.stringify({ token: "t".repeat(32) }));
    expect(loadConfig(file).quota.pauseAt).toBe(0.9);
    writeFileSync(file, JSON.stringify({ token: "t".repeat(32), quota: { pauseAt: null } }));
    expect(loadConfig(file).quota.pauseAt).toBeNull();
    expect(Config.safeParse({ quota: { pauseAt: 1.5 } }).success).toBe(false);
  });
});
