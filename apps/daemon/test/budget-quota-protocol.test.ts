import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Budget } from "@flightdeck/protocol";
import { startDaemon } from "../src/main.ts";
import { tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "budget-quota-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function daemon() {
  const dir = tempDir();
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      port: 0,
      token: TOKEN,
      dataDir: join(dir, "data"),
      allowedRoots: [dir],
      history: { roots: [join(dir, "nada")] },
    }),
  );
  const running = await startDaemon(
    { command: "start", config: file, runtime: "fake" },
    {},
    { log: () => {}, error: () => {} },
  );
  cleanups.push(() => running.stop());
  const client = new FrameClient(`ws://127.0.0.1:${new URL(running.url).port}/v1/ws`);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return client;
}

describe("budget-quota-protocol: the app sets a budget in terms of a plan quota window (#1248)", () => {
  test("the host announces quotaBudgets, and budget.setQuota takes a window with a share instead of dollars", async () => {
    const client = await daemon();
    const info = await client.data<{ features?: string[] }>("host.info", {});
    expect(info?.features).toContain("quotaBudgets");

    const budget = await client.data<Budget>("budget.setQuota", {
      scope: "host",
      window: "five_hour",
      limitPct: 0.8,
      action: "queue",
    });
    expect(budget).toMatchObject({
      period: "five_hour",
      limitUsd: 0,
      limitPct: 0.8,
      spentPct: 0,
      estimated: false,
      periodKey: "unread",
      fraction: 0,
    });
    const listed = await client.data<{ budgets: Budget[] }>("budget.list", {});
    expect(listed?.budgets.map((b) => b.id)).toEqual([budget?.id as string]);
  });

  test("a share above 100%, none, or dollars for a window are refused and nothing is created", async () => {
    const client = await daemon();
    const send = (extra: Record<string, unknown>) =>
      client.request("budget.setQuota", { scope: "host", action: "notify", ...extra });
    for (const extra of [
      { window: "seven_day", limitPct: 1.5 },
      { window: "seven_day", limitPct: 0 },
      // So small that the fraction of any use would not be a finite number.
      { window: "five_hour", limitPct: 1e-9 },
      { window: "seven_day" },
      { window: "five_hour", limitUsd: 5 },
      { window: "day", limitPct: 0.5 },
    ]) {
      const ack = await send(extra);
      expect(ack.ok).toBe(false);
      expect(ack.error).toMatchObject({ code: "bad_request", reason: "request_invalid" });
    }
    const listed = await client.data<{ budgets: Budget[] }>("budget.list", {});
    expect(listed?.budgets).toEqual([]);
  });
});
