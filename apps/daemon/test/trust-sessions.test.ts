import { describe, expect, test } from "bun:test";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { newManager, waitFor } from "./helpers.ts";

describe("trust-sessions: every run of a session is told whether its folder is trusted (#196)", () => {
  test("a new session and a resumed one ask the provider for their own folder", async () => {
    const asked: string[] = [];
    const runtime = new FakeRuntime({ delayMs: 1 });
    const { manager, project, start } = newManager({
      runtime,
      trust: (cwd) => {
        asked.push(cwd);
        return { trusted: false, configRoot: "/main/checkout" };
      },
    });
    const created = await start({ cwd: project, prompt: "oi" });
    await waitFor(() => manager.get(created.sessionId).status === "idle", { label: "idle" });
    expect(asked[0]).toBe(manager.get(created.sessionId).cwd);
    expect(runtime.starts[0]?.trust).toEqual({ trusted: false, configRoot: "/main/checkout" });
    await manager.close(created.sessionId);
    await manager.resume(created.sessionId);
    await waitFor(() => runtime.starts.length >= 2, { label: "second start" });
    expect(runtime.starts.at(-1)?.trust).toEqual({ trusted: false, configRoot: "/main/checkout" });
  });

  test("without a provider the run carries no trust decision (the previous behaviour)", async () => {
    const runtime = new FakeRuntime({ delayMs: 1 });
    const { project, start } = newManager({ runtime });
    await start({ cwd: project, prompt: "oi" });
    await waitFor(() => runtime.starts.length >= 1, { label: "start" });
    expect(runtime.starts[0]?.trust).toBeUndefined();
  });

  test("the folder is looked at before a new session and a resumed one run, then decided", async () => {
    const order: string[] = [];
    const runtime = new FakeRuntime({ delayMs: 1 });
    const { manager, project, start } = newManager({
      runtime,
      prepareTrust: async (cwd) => {
        await Bun.sleep(5);
        order.push(`prepare ${cwd}`);
      },
      trust: () => {
        order.push("decide");
        return { trusted: true };
      },
    });
    const created = await start({ cwd: project, prompt: "oi" });
    await waitFor(() => manager.get(created.sessionId).status === "idle", { label: "idle" });
    expect(order.slice(0, 2)).toEqual([`prepare ${manager.get(created.sessionId).cwd}`, "decide"]);
    await manager.close(created.sessionId);
    order.length = 0;
    await manager.resume(created.sessionId);
    expect(order.slice(0, 2)).toEqual([`prepare ${manager.get(created.sessionId).cwd}`, "decide"]);
  });
});
