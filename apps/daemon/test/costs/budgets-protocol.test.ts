import { afterEach, describe, expect, test } from "bun:test";
import { startServer } from "../../src/server.ts";
import { cleanups, HOST_DAY, runCleanups, setup } from "../support/costs-budgets.ts";
import { newManager, poll } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

const TOKEN = "budgets-token-0123456789abcdef";
afterEach(runCleanups);

describe("orcamentos pelo protocolo", () => {
  test("budget.list, budget.set, budget.remove e budget.watch pelo protocolo", async () => {
    const { budgets, spend } = setup();
    spend(6);
    const { manager, root } = newManager();
    const server = startServer({
      manager,
      costs: { budgets },
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
    expect(await client.data("budget.watch", {})).toBeUndefined();
    const made = await client.data<{ id: string; crossed: number[] }>("budget.set", HOST_DAY);
    expect(made?.crossed).toEqual([0.5]);
    expect(
      (await client.data<{ budgets: Array<{ id: string }> }>("budget.list", {}))?.budgets.map(
        (b) => b.id,
      ),
    ).toEqual([made?.id ?? ""]);
    await client.request("budget.remove", { id: made?.id });
    expect(await client.data("budget.list", {})).toEqual({ budgets: [] });
    const updates = () => client.frames.filter((f) => f.type === "budget.updated");
    await poll(() => updates().length === 2);
    expect(updates().map((f) => [f.threshold, f.removed])).toEqual([
      [0.5, false],
      [null, true],
    ]);
    expect(await client.request("budget.set", { ...HOST_DAY, limitUsd: 0 })).toMatchObject({
      ok: false,
      error: { code: "bad_request" },
    });
    expect(await client.request("budget.set", { ...HOST_DAY, scope: "project" })).toMatchObject({
      ok: false,
      error: { code: "bad_request" },
    });
  });
});
