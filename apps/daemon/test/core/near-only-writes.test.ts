import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { McpConfig } from "../../src/agentcfg/mcp.ts";
import { startServer } from "../../src/server.ts";
import { SecretScanner } from "../../src/snippets/domain/model.ts";
import { Snippets } from "../../src/snippets/store.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { TerminalManager } from "../../src/terminal/terminal-manager.ts";
import { newBoard } from "../support/board-helpers.ts";
import { tempDir } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";
import { fakePtys } from "../support/pty-helpers.ts";

setDefaultTimeout(30_000);

const TOKEN = "near-writes-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #3807: what makes the host run a command (a project's setup script, the terminal switch, a
 * trusted snippet file, a server of `.mcp.json` and its turning on) needs a near connection (this
 * computer or Tailscale), as trusting a workflow does. What runs nothing, or only turns a thing off,
 * answers anywhere.
 */
async function nearAndFar() {
  const { board, manager, repo, root } = newBoard();
  const project = await board.addProject({ path: repo });
  const terminals = new TerminalManager({
    pty: fakePtys().factory,
    allowedRoots: [root],
    enabled: false,
    platform: "linux",
    env: () => ({ SHELL: "/bin/sh" }),
    log: () => {},
  });
  const snippets = new Snippets({
    db: new EventStore(":memory:").db,
    allowedRoots: [root],
    scanner: new SecretScanner(),
  });
  const base = {
    manager,
    board,
    terminals,
    snippets: { library: snippets },
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
    terminals.stop();
    await board.stop();
  });
  for (const client of clients) await client.request("hello", { token: TOKEN, client: "t" });
  const [near, far] = clients as [FrameClient, FrameClient];
  const reasonOf = async (call: Promise<{ error?: unknown }>) =>
    ((await call).error as { reason?: string } | undefined)?.reason ?? null;
  return { near, far, board, project, repo, terminals, snippets, reasonOf };
}

describe("a project's setup script needs a near connection (#3807)", () => {
  test("a far connection cannot add or set one, and can still change the rest or clear it; a near one sets it", async () => {
    const { near, far, board, project, repo, reasonOf } = await nearAndFar();
    const script = "touch ready";
    const farAdd = await reasonOf(far.request("project.add", { path: repo, setupScript: script }));
    const farSet = await reasonOf(
      far.request("project.update", { projectId: project.id, setupScript: script }),
    );
    const afterFar = board.getProject(project.id).setupScript;
    const farRename = await reasonOf(
      far.request("project.update", { projectId: project.id, name: "renamed" }),
    );
    const nearSet = await reasonOf(
      near.request("project.update", { projectId: project.id, setupScript: script }),
    );
    const afterNear = board.getProject(project.id).setupScript;
    const farClear = await reasonOf(
      far.request("project.update", { projectId: project.id, setupScript: null }),
    );
    expect([
      farAdd,
      farSet,
      afterFar,
      farRename,
      nearSet,
      afterNear,
      farClear,
      board.getProject(project.id).setupScript,
    ]).toEqual(["transport_refused", "transport_refused", null, null, null, script, null, null]);
  });
});

describe("turning the terminal on needs a near connection (#3807)", () => {
  test("a far connection cannot turn it on, can turn it off; a near one turns it on", async () => {
    const { near, far, terminals, reasonOf } = await nearAndFar();
    const on = { enabled: true, confirm: true };
    const farOn = await reasonOf(far.request("terminal.settings", on));
    const afterFar = terminals.enabled;
    const nearOn = await reasonOf(near.request("terminal.settings", on));
    const afterNear = terminals.enabled;
    const farOff = await reasonOf(far.request("terminal.settings", { enabled: false }));
    expect([farOn, afterFar, nearOn, afterNear, farOff, terminals.enabled]).toEqual([
      "transport_refused",
      false,
      null,
      true,
      null,
      false,
    ]);
  });
});

describe("trusting a project's snippet file needs a near connection (#3807)", () => {
  test("a far connection is refused and the file stays untrusted; a near one trusts it", async () => {
    const { near, far, repo, snippets, reasonOf } = await nearAndFar();
    mkdirSync(join(repo, ".flightdeck"), { recursive: true });
    writeFileSync(
      join(repo, ".flightdeck", "snippets.yaml"),
      '- name: build\n  type: command\n  text: "echo hi"\n',
    );
    const info = async () => (await snippets.list({ projectPath: repo })).file;
    const hash = (await info())?.hash ?? "";
    const ask = { projectPath: repo, hash };
    const farTrust = await reasonOf(far.request("snippets.trust", ask));
    const afterFar = (await info())?.trusted;
    const nearTrust = await reasonOf(near.request("snippets.trust", ask));
    expect([farTrust, afterFar, nearTrust, (await info())?.trusted]).toEqual([
      "transport_refused",
      false,
      null,
      true,
    ]);
  });
});

describe("saving an MCP server and turning one on need a near connection (#3807)", () => {
  test("a far connection cannot save a server or turn one on, can turn one off; a near one can", async () => {
    const { near, far, project, repo, reasonOf } = await nearAndFar();
    const server = { name: "novo", command: "bun", args: ["x"] };
    const saved = () =>
      existsSync(join(repo, ".mcp.json")) &&
      readFileSync(join(repo, ".mcp.json"), "utf8").includes("novo");
    const farSave = await reasonOf(
      far.request("mcp.save", { projectId: project.id, server, confirm: true }),
    );
    const afterFar = saved();
    const nearSave = await reasonOf(
      near.request("mcp.save", { projectId: project.id, server, confirm: true }),
    );
    const toggle = { projectId: project.id, name: "novo", confirm: true };
    const farOn = await reasonOf(far.request("mcp.toggle", { ...toggle, enabled: true }));
    const farOff = await reasonOf(far.request("mcp.toggle", { ...toggle, enabled: false }));
    const nearOn = await reasonOf(near.request("mcp.toggle", { ...toggle, enabled: true }));
    expect([farSave, afterFar, nearSave, saved(), farOn, farOff, nearOn]).toEqual([
      "transport_refused",
      false,
      null,
      true,
      "transport_refused",
      null,
      null,
    ]);
  });
});
