import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Idle } from "../../src/messaging/domain/idle.ts";
import { flightdeckMcpServer } from "../../src/runtime/domain/flightdeck-mcp.ts";
import { startServer } from "../../src/server.ts";
import { newManager, tempDir } from "../support/helpers.ts";
import { startedWith } from "../support/mcp-sessions.ts";
import { setup } from "../support/messaging-helpers.ts";

setDefaultTimeout(30_000);

const TOKEN = "mcp-sessoes-token-0123456789abcdef";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("mcp-sessoes: the real server over stdio", () => {
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
      messaging: { messages: base.messaging, idle },
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
    const main = join(import.meta.dir, "../../src/bin.ts");
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
});
