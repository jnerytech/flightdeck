import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { runDoctor } from "../src/doctor.ts";
import { Idle } from "../src/messaging/idle.ts";
import { ClaudeSdkRuntime, type QueryFn } from "../src/runtime/claude-sdk-runtime.ts";
import { type FlightdeckMcpServer, flightdeckMcpServer } from "../src/runtime/flightdeck-mcp.ts";
import { startServer } from "../src/server.ts";
import { newManager, tempDir } from "./helpers.ts";
import { setup } from "./mensagens-helpers.ts";

setDefaultTimeout(30_000);

const TOKEN = "mcp-sessoes-token-0123456789abcdef";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Starts a run and returns the options the SDK would have received. */
function startedWith(
  mcpServer: FlightdeckMcpServer | undefined,
  permissionMode: "default" | "acceptEdits" | "plan",
  sessionId: string | null = "s1",
): Options {
  let captured: Options | undefined;
  const query: QueryFn = (params) => {
    captured = params.options as Options;
    return {
      async *[Symbol.asyncIterator]() {
        yield {
          type: "system",
          subtype: "init",
          session_id: "c1",
          model: "m",
          tools: [],
        } as never as SDKMessage;
      },
      interrupt: async () => {},
      close: () => {},
    };
  };
  new ClaudeSdkRuntime({ query, ...(mcpServer ? { mcpServer } : {}) }).start({
    cwd: "/proj",
    permissionMode,
    env: { PATH: "/bin", ...(sessionId === null ? {} : { FLIGHTDECK_SESSION: sessionId }) },
    canUseTool: async () => ({ behavior: "allow" }),
  });
  return captured as Options;
}

describe("mcp-sessoes", () => {
  test("the command is this daemon's binary running mcp with its config file", () => {
    expect(flightdeckMcpServer(["/opt/fd/flightdeckd"], "/home/u/config.json")).toEqual({
      command: "/opt/fd/flightdeckd",
      args: ["mcp", "--config", "/home/u/config.json"],
    });
    expect(flightdeckMcpServer(["/usr/bin/bun", "run", "/src/main.ts"], "/c.json")).toEqual({
      command: "/usr/bin/bun",
      args: ["run", "/src/main.ts", "mcp", "--config", "/c.json"],
    });
  });

  test("a managed session gets the flightdeck MCP server, with its own session id", () => {
    const options = startedWith({ command: "/fd", args: ["mcp"] }, "default");
    expect(options.mcpServers).toEqual({
      flightdeck: {
        type: "stdio",
        command: "/fd",
        args: ["mcp"],
        env: { FLIGHTDECK_SESSION: "s1" },
      },
    });
  });

  test("a session that carries no id still gets the server, with no environment of its own", () => {
    const options = startedWith({ command: "/fd", args: ["mcp"] }, "default", null);
    expect(options.mcpServers).toEqual({
      flightdeck: { type: "stdio", command: "/fd", args: ["mcp"] },
    });
  });

  test("it adds to the user and project servers: their settings still load and nothing is made exclusive", () => {
    const options = startedWith({ command: "/fd", args: ["mcp"] }, "default");
    expect(options.settingSources).toEqual(["user", "project", "local"]);
    expect(Object.keys(options.mcpServers ?? {})).toEqual(["flightdeck"]);
    expect(options.strictMcpConfig).toBeUndefined();
  });

  test("the permission mode the session was started with is kept, plan is not forced", () => {
    expect(startedWith({ command: "/fd", args: ["mcp"] }, "acceptEdits").permissionMode).toBe(
      "acceptEdits",
    );
    expect(startedWith({ command: "/fd", args: ["mcp"] }, "default").permissionMode).toBe(
      "default",
    );
  });

  test("a runtime without the server option sends none", () => {
    expect(startedWith(undefined, "default").mcpServers).toBeUndefined();
  });

  test("the exact server a session is given starts and a worker calls send_to_session through it", async () => {
    const base = setup();
    const idle = new Idle({
      endpoints: base.endpoints,
      messaging: base.messaging,
      host: "pc",
      clock: () => base.now.at,
    });
    const { manager } = newManager();
    const server = startServer({
      manager,
      messaging: base.messaging,
      idle,
      hostName: "pc",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => {
      void server.stop();
      idle.stop();
      base.messaging.stop();
    });
    base.endpoints.add("s1", { name: "coordenadora" });
    base.endpoints.add("s2", { name: "executora", state: "running" });
    const file = join(tempDir(), "config.json");
    writeFileSync(
      file,
      JSON.stringify({ token: TOKEN, port: server.port, dataDir: join(tempDir(), "data") }),
    );
    const main = join(import.meta.dir, "..", "src", "bin.ts");
    const given = startedWith(
      flightdeckMcpServer([process.execPath, "run", main], file),
      "default",
      "s2",
    ).mcpServers?.flightdeck as { command: string; args: string[]; env: Record<string, string> };
    const transport = new StdioClientTransport({
      command: given.command,
      args: given.args,
      cwd: tempDir(),
      env: { PATH: process.env.PATH ?? "", HOME: tempDir(), ...given.env },
    });
    const client = new Client({ name: "teste", version: "1.0.0" });
    await client.connect(transport);
    cleanups.push(() => client.close());
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(
      expect.arrayContaining([
        "send_to_session",
        "list_sessions",
        "notify_when_idle",
        "team_status",
      ]),
    );
    const sent = await client.callTool({
      name: "send_to_session",
      arguments: { to: "pc/s1", text: "feito" },
    });
    const text = (sent.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(sent.isError).toBeFalsy();
    expect(JSON.parse(text)).toMatchObject({ resultado: "entregue" });
  });

  test("doctor: the MCP server of sessions starts, or says the one line that fixes it", async () => {
    const base = {
      config: () => ({ bind: "127.0.0.1", port: 7777, allowedRoots: ["/code"] }),
      isDirectory: () => true,
      serviceInstalled: async () => true,
      healthy: async () => true,
      tailscaleIp: async () => null,
      hooks: () => "installed" as const,
      claudePath: () => "/usr/bin/claude",
    };
    const ok = await runDoctor({ ...base, mcp: async () => ({ command: "/fd", exists: true }) });
    expect(ok.checks.find((c) => c.id === "mcp")).toMatchObject({ status: "ok" });
    const missing = await runDoctor({
      ...base,
      mcp: async () => ({ command: "/gone/flightdeckd", exists: false }),
    });
    expect(missing.checks.find((c) => c.id === "mcp")).toMatchObject({
      status: "warn",
      fix: "run: flightdeckd setup",
    });
    expect(missing.checks.find((c) => c.id === "mcp")?.detail).toContain("/gone/flightdeckd");
  });
});
