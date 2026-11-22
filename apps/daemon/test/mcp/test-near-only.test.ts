import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { McpConfig } from "../../src/agentcfg/mcp.ts";
import { startServer } from "../../src/server.ts";
import { newBoard } from "../support/board-helpers.ts";
import { poll, tempDir } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

setDefaultTimeout(30_000);

const TOKEN = "mcp-near-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #3807: a confirmed `mcp.test` starts a command from the project's `.mcp.json` on the host,
 * so only a near connection (this computer or Tailscale) may confirm it, as it may confirm a
 * resume. The preview starts nothing and answers anywhere.
 */
describe("mcp.test with confirm is near only (#3807)", () => {
  test("a far connection is refused with transport_refused and starts nothing, its preview still answers; a near one starts the server", async () => {
    const { board, manager, repo, root } = newBoard();
    const project = await board.addProject({ path: repo });
    const marker = join(repo, "started.txt");
    writeFileSync(
      join(repo, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          marker: {
            command: process.execPath,
            args: ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`],
          },
        },
      }),
    );
    const base = {
      manager,
      board,
      agentSetup: { mcp: new McpConfig({ userConfigPath: join(tempDir(), ".claude.json") }) },
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [root],
      allowedNetworks: ["0.0.0.0/0", "::/0"],
    };
    const servers = [startServer(base), startServer({ ...base, peerOf: () => "8.8.8.8" })];
    const clients = servers.map((server) => new FrameClient(server.url));
    cleanups.push(async () => {
      for (const client of clients) client.close();
      for (const server of servers) await server.stop();
      await board.stop();
    });
    for (const client of clients) await client.request("hello", { token: TOKEN, client: "t" });
    const [near, far] = clients as [FrameClient, FrameClient];
    const ask = { projectId: project.id, name: "marker" };
    const reasonOf = (frame: { error?: unknown }) =>
      (frame.error as { reason?: string } | undefined)?.reason ?? null;
    const preview = await far.request("mcp.test", ask);
    const refused = await far.request("mcp.test", { ...ask, confirm: true });
    const startedByFar = existsSync(marker);
    // The marker command is no MCP server, so the test itself ends in an error: what counts is
    // that it was not refused for its transport and that the command ran.
    const accepted = await near.request("mcp.test", { ...ask, confirm: true });
    const startedByNear = (await poll(() => existsSync(marker) || undefined)) ?? false;
    expect([
      preview.ok,
      reasonOf(refused),
      startedByFar,
      reasonOf(accepted),
      startedByNear,
    ]).toEqual([true, "transport_refused", false, null, true]);
  });
});
