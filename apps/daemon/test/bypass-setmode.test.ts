import { describe, expect, test } from "bun:test";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeSdkRuntime, type QueryFn } from "../src/runtime/claude-sdk-runtime.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { newManager, poll } from "./helpers.ts";

async function live(allowBypass: boolean, mode: "default" | "plan" = "default") {
  const runtime = new FakeRuntime({ delayMs: 1 });
  const { manager, project } = newManager({ runtime, allowBypass: () => allowBypass });
  const { sessionId } = manager.create({ cwd: project, prompt: "hi", permissionMode: mode });
  await poll(() => manager.get(sessionId).status === "idle", 3000);
  return { manager, runtime, sessionId };
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).message;
  }
}

describe("bypass-setmode", () => {
  test("with the switch on a live session takes any mode: bypassPermissions, and looser than it started", async () => {
    const { manager, runtime, sessionId } = await live(true, "plan");
    await manager.setPermissionMode(sessionId, "bypassPermissions");
    await manager.setPermissionMode(sessionId, "acceptEdits");
    expect(runtime.modes).toEqual(["bypassPermissions", "acceptEdits"]);
  });

  test("with the switch off it stays as before: never looser than the start mode", async () => {
    const { manager, runtime, sessionId } = await live(false, "plan");
    expect(await code(manager.setPermissionMode(sessionId, "bypassPermissions"))).toBe(
      "invalid_permission_update",
    );
    expect(await code(manager.setPermissionMode(sessionId, "default"))).toBe(
      "invalid_permission_update",
    );
    expect(runtime.modes).toEqual([]);
  });

  test("the run starts allowed to switch only on a host with the switch on", async () => {
    const on = await live(true);
    expect(on.runtime.starts.map((s) => s.allowBypass)).toEqual([true]);
    const off = await live(false);
    expect(off.runtime.starts.map((s) => s.allowBypass)).toEqual([false]);
  });

  test("the SDK gets allowDangerouslySkipPermissions only when the run may switch", () => {
    const seen: Options[] = [];
    const queryFn: QueryFn = (params) => {
      seen.push((params as { options: Options }).options);
      return {
        async *[Symbol.asyncIterator]() {},
        interrupt: async () => {},
        close: () => {},
      } as never;
    };
    const runtime = new ClaudeSdkRuntime({ query: queryFn, claudePath: "/bin/claude" });
    const base = { cwd: "/p", permissionMode: "default" as const, env: {} };
    const canUseTool = async () => ({ behavior: "allow" as const });
    runtime.start({ ...base, canUseTool, allowBypass: true });
    runtime.start({ ...base, canUseTool, allowBypass: false });
    runtime.start({ ...base, canUseTool });
    expect(seen.map((o) => o.allowDangerouslySkipPermissions)).toEqual([
      true,
      undefined,
      undefined,
    ]);
  });
});
