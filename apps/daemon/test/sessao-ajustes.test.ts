import { afterEach, describe, expect, test } from "bun:test";
import { Command, type SessionEvent } from "@flightdeck/protocol";
import { ClaudeSdkRuntime, type QueryFn } from "../src/runtime/claude-sdk-runtime.ts";
import { FakeRuntime, fakeSlashCommands } from "../src/runtime/fake-runtime.ts";
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
  const { sessionId } = await manager.create({ cwd: project, prompt: "hi" });
  await poll(() => manager.get(sessionId).status === "idle", 3000);
  return { manager, store, runtime, sessionId };
}

describe("sessao-ajustes: mode, model and slash commands of a live session", () => {
  test("the fake can list as many slash commands as asked, plain, plugin and MCP ones, from the option or the environment", () => {
    const names = fakeSlashCommands(100);
    expect(names).toHaveLength(100);
    expect(new Set(names).size).toBe(100);
    expect(names.some((n) => n.startsWith("mcp__"))).toBe(true);
    expect(names.some((n) => n.includes(":") && !n.startsWith("mcp__"))).toBe(true);
    expect(names.some((n) => !n.includes(":") && !n.startsWith("mcp__"))).toBe(true);
    process.env.FLIGHTDECK_FAKE_SLASH = "7";
    try {
      expect(
        (new FakeRuntime() as unknown as { slashCommands?: string[] }).slashCommands,
      ).toHaveLength(7);
    } finally {
      delete process.env.FLIGHTDECK_FAKE_SLASH;
    }
  });

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
    expect(await code(manager.setEffort("nope", "high"))).toBe("invalid_state");
  });

  test("the effort goes to the live run; null is the model's default", async () => {
    const { manager, runtime, sessionId } = await liveSession();
    await manager.setEffort(sessionId, "high");
    await manager.setEffort(sessionId, null);
    expect(runtime.efforts).toEqual(["high", undefined]);
  });

  test("a run that cannot change its effort (OpenCode) refuses: invalid_state", async () => {
    const { manager, sessionId } = await liveSession();
    const live = (manager as unknown as { live: Map<string, { run: { setEffort?: unknown } }> })
      .live;
    const run = live.get(sessionId)?.run;
    if (run) run.setEffort = undefined;
    expect(await code(manager.setEffort(sessionId, "low"))).toBe("invalid_state");
  });

  test("the SDK runtime sets the effort through applyFlagSettings, null clearing it", async () => {
    const seen: string[] = [];
    const queryFn: QueryFn = () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "c1",
          model: "m",
          tools: [],
        } as never;
      },
      interrupt: async () => {},
      close: () => {},
      applyFlagSettings: async (settings) => void seen.push(JSON.stringify(settings)),
    });
    const run = new ClaudeSdkRuntime({ query: queryFn }).start({
      cwd: "/proj",
      permissionMode: "default",
      env: {},
      canUseTool: async () => ({ behavior: "allow" }),
    });
    await run.events[Symbol.asyncIterator]().next();
    await run.setEffort?.("xhigh");
    await run.setEffort?.(undefined);
    expect(seen).toEqual(['{"effortLevel":"xhigh"}', '{"effortLevel":null}']);
    await run.close();
  });

  test("the session.init of the fake and of the SDK runtime carry the slash commands", async () => {
    const { store, sessionId } = await liveSession();
    const init = store
      .eventsSince(sessionId)
      .map((e) => e.event)
      .find((e): e is Extract<SessionEvent, { type: "session.init" }> => e.type === "session.init");
    expect(init?.slashCommands).toEqual(["compact", "review"]);
    expect(init?.commands?.map((c) => [c.name, c.kind, c.description !== ""])).toEqual([
      ["compact", "builtin", true],
      ["review", "builtin", true],
    ]);
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
      sessionSettings: true,
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
    expect(await client.request("session.setEffort", { sessionId, effort: "max" })).toMatchObject({
      ok: true,
    });
    expect(
      await client.request("session.setMode", { sessionId: "nope", permissionMode: "plan" }),
    ).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    const info = await client.data<{ features: string[] }>("host.info", {});
    expect(info?.features).toContain("session.settings");
    expect(info?.features).toContain("session.effort");
  });

  test("the command takes default, acceptEdits, plan and bypassPermissions (the daemon refuses it unless the host allows): never dontAsk or auto", () => {
    const parse = (permissionMode: string) =>
      Command.safeParse({
        id: "1",
        type: "session.setMode",
        payload: { sessionId: "s", permissionMode },
      }).success;
    expect(["default", "acceptEdits", "plan", "bypassPermissions"].map(parse)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(["dontAsk", "auto"].map(parse)).toEqual([false, false]);
  });

  test("a session never goes looser than the mode it started with", async () => {
    const start = async (permissionMode: "default" | "acceptEdits" | "plan") => {
      const { manager, project } = newManager({
        runtime: new FakeRuntime({ delayMs: 1 }),
      });
      const { sessionId } = await manager.create({ cwd: project, prompt: "hi", permissionMode });
      await poll(() => manager.get(sessionId).status === "idle", 3000);
      return { manager, sessionId };
    };
    const fromDefault = await start("default");
    expect(
      await code(fromDefault.manager.setPermissionMode(fromDefault.sessionId, "acceptEdits")),
    ).toBe("invalid_permission_update");
    expect(await code(fromDefault.manager.setPermissionMode(fromDefault.sessionId, "plan"))).toBe(
      "ok",
    );
    const fromPlan = await start("plan");
    expect(await code(fromPlan.manager.setPermissionMode(fromPlan.sessionId, "default"))).toBe(
      "invalid_permission_update",
    );
    const fromAccept = await start("acceptEdits");
    expect(await code(fromAccept.manager.setPermissionMode(fromAccept.sessionId, "default"))).toBe(
      "ok",
    );
    expect(
      await code(fromAccept.manager.setPermissionMode(fromAccept.sessionId, "acceptEdits")),
    ).toBe("ok");
  });

  test("a mode change the run took is told as a session.mode event, so every app and a reload show it (#935)", async () => {
    const { manager, store, sessionId } = await liveSession();
    await manager.setPermissionMode(sessionId, "plan");
    await code(manager.setPermissionMode(sessionId, "acceptEdits"));
    const modes = store
      .eventsSince(sessionId)
      .filter((e) => e.event.type === "session.mode")
      .map((e) => (e.event as { permissionMode?: string }).permissionMode);
    expect(modes).toEqual(["plan"]);
  });

  test("a run started again (resume, a restart) starts in the mode the session last reported, never back in the start mode (#935)", async () => {
    const { manager, runtime, sessionId } = await liveSession();
    await manager.setPermissionMode(sessionId, "plan");
    await manager.close(sessionId);
    await poll(() => manager.get(sessionId).status === "ended", 3000);
    await manager.resume(sessionId);
    expect(runtime.starts.map((start) => start.permissionMode)).toEqual(["default", "plan"]);
  });
});
