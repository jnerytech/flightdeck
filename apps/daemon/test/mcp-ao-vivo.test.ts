import { afterEach, describe, expect, test } from "bun:test";
import { ClaudeSdkRuntime, type QueryFn } from "../src/runtime/claude-sdk-runtime.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { startServer } from "../src/server.ts";
import { newManager, poll } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "mcp-live-token-0123456789abcdef";

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

/** A manager over a fake runtime that has two MCP servers, with an idle session. */
async function liveSession() {
  const runtime = new FakeRuntime({ delayMs: 1, mcpServers: ["eco", "outro"] });
  const { manager, project } = newManager({ runtime });
  const { sessionId } = manager.create({ cwd: project, prompt: "hi" });
  await poll(() => manager.get(sessionId).status === "idle", 3000);
  return { manager, runtime, sessionId };
}

describe("mcp-ao-vivo", () => {
  test("the status of the servers of a live managed session comes from its runtime", async () => {
    const { manager, sessionId } = await liveSession();
    expect(await manager.mcpStatus(sessionId)).toEqual([
      { name: "eco", status: "connected" },
      { name: "outro", status: "connected" },
    ]);
  });

  test("a server turned off in the live session reads as disabled", async () => {
    const { manager, sessionId } = await liveSession();
    await manager.toggleMcpServer(sessionId, "outro", false);
    expect((await manager.mcpStatus(sessionId)).map((s) => [s.name, s.status])).toEqual([
      ["eco", "connected"],
      ["outro", "disabled"],
    ]);
    await manager.toggleMcpServer(sessionId, "outro", true);
    expect((await manager.mcpStatus(sessionId)).map((s) => s.status)).toEqual([
      "connected",
      "connected",
    ]);
  });

  test("a session that is not live has no status: invalid_state", async () => {
    const { manager } = await liveSession();
    expect(await code(manager.mcpStatus("does-not-exist"))).toBe("invalid_state");
  });

  test("the SDK runtime reports the status the query gives, keeping name, status and error", async () => {
    const queryFn: QueryFn = () => ({
      async *[Symbol.asyncIterator]() {},
      interrupt: async () => {},
      close: () => {},
      mcpServerStatus: async () => [
        { name: "eco", status: "connected", serverInfo: { name: "eco", version: "1" } },
        { name: "remote", status: "failed", error: "connection refused" },
      ],
    });
    const run = new ClaudeSdkRuntime({ query: queryFn }).start({
      cwd: "/proj",
      permissionMode: "default",
      env: {},
      canUseTool: async () => ({ behavior: "allow" }),
    });
    expect(await run.mcpServerStatus?.()).toEqual([
      { name: "eco", status: "connected" },
      { name: "remote", status: "failed", error: "connection refused" },
    ]);
    await run.close();
  });

  test("protocol: mcp.status answers with the servers of the session, and invalid_state without one", async () => {
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
    const result = await client.data<{ servers: Array<{ name: string; status: string }> }>(
      "mcp.status",
      { sessionId },
    );
    expect(result?.servers.map((s) => [s.name, s.status])).toEqual([
      ["eco", "connected"],
      ["outro", "connected"],
    ]);
    expect(await client.request("mcp.status", { sessionId: "does-not-exist" })).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
  });
});
