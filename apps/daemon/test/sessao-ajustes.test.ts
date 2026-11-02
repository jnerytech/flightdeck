import { afterEach, describe, expect, test } from "bun:test";
import type { SessionEvent } from "@flightdeck/protocol";
import { ClaudeSdkRuntime, type QueryFn } from "../src/runtime/claude-sdk-runtime.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { startServer } from "../src/server.ts";
import { newManager, poll } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "ajustes-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).message;
  }
}

async function liveSession() {
  const runtime = new FakeRuntime({ delayMs: 1, slashCommands: ["compact", "review"] });
  const { manager, store, project } = newManager({ runtime });
  const { sessionId } = manager.create({ cwd: project, prompt: "hi" });
  await poll(() => manager.get(sessionId).status === "idle", 3000);
  return { manager, store, runtime, sessionId };
}

describe("sessao-ajustes: mode, model and slash commands of a live session", () => {
  test("the mode and the model go to the live run; null is the default model", async () => {
    const { manager, runtime, sessionId } = await liveSession();
    await manager.setPermissionMode(sessionId, "plan");
    await manager.setModel(sessionId, "opus");
    await manager.setModel(sessionId, null);
    expect(runtime.modes).toEqual(["plan"]);
    expect(runtime.models).toEqual(["opus", undefined]);
  });

  test("a session that is not live cannot change them: invalid_state", async () => {
    const { manager } = await liveSession();
    expect(await code(manager.setPermissionMode("nope", "plan"))).toBe("invalid_state");
    expect(await code(manager.setModel("nope", "opus"))).toBe("invalid_state");
  });

  test("the session.init of the fake and of the SDK runtime carry the slash commands", async () => {
    const { store, sessionId } = await liveSession();
    const init = store
      .eventsSince(sessionId)
      .map((e) => e.event)
      .find((e): e is Extract<SessionEvent, { type: "session.init" }> => e.type === "session.init");
    expect(init?.slashCommands).toEqual(["compact", "review"]);
    const seen: Array<string | undefined> = [];
    const queryFn: QueryFn = () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "c1",
          model: "m",
          tools: [],
          slash_commands: ["compact", "init"],
        } as never;
      },
      interrupt: async () => {},
      close: () => {},
      setPermissionMode: async (mode) => void seen.push(`mode:${mode}`),
      setModel: async (model) => void seen.push(`model:${model}`),
    });
    const run = new ClaudeSdkRuntime({ query: queryFn }).start({
      cwd: "/proj",
      permissionMode: "default",
      env: {},
      canUseTool: async () => ({ behavior: "allow" }),
    });
    const first = await run.events[Symbol.asyncIterator]().next();
    expect(first.value).toMatchObject({ type: "session.init", slashCommands: ["compact", "init"] });
    await run.setPermissionMode?.("acceptEdits");
    await run.setModel?.(undefined);
    expect(seen).toEqual(["mode:acceptEdits", "model:undefined"]);
    await run.close();
  });

  test("protocol: the commands answer, refuse a session that is not live, and host.info announces them", async () => {
    const { manager, sessionId } = await liveSession();
    const server = startServer({
      manager,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    expect(
      await client.request("session.setMode", { sessionId, permissionMode: "plan" }),
    ).toMatchObject({ ok: true });
    expect(await client.request("session.setModel", { sessionId, model: "opus" })).toMatchObject({
      ok: true,
    });
    expect(
      await client.request("session.setMode", { sessionId: "nope", permissionMode: "plan" }),
    ).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    const info = await client.data<{ features: string[] }>("host.info", {});
    expect(info?.features).toContain("session.settings");
  });
});
