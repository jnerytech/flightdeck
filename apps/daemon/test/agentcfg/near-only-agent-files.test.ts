import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AgentConfig } from "../../src/agentcfg/files.ts";
import { startServer } from "../../src/server.ts";
import { newBoard } from "../support/board-helpers.ts";
import { tempDir } from "../support/helpers.ts";
import { FrameClient } from "../support/history-helpers.ts";

setDefaultTimeout(30_000);

const TOKEN = "agentcfg-near-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #3815: an agent or a skill can declare `hooks` that run a command on every event of the session that
 * uses it, and a CLAUDE.md steers every session of the project, so writing any of them needs a near
 * connection (this computer or Tailscale). Reading answers anywhere.
 */
async function nearAndFar() {
  const { board, manager, repo, root } = newBoard();
  const project = await board.addProject({ path: repo });
  const base = {
    manager,
    board,
    agentSetup: { agentcfg: new AgentConfig({ claudeDir: tempDir("fd-claude-") }) },
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
  const reasonOf = async (call: Promise<{ error?: unknown }>) =>
    ((await call).error as { reason?: string } | undefined)?.reason ?? null;
  const write = (client: FrameClient, kind: string, path: string, content: string) =>
    reasonOf(
      client.request("agentcfg.write", {
        projectId: project.id,
        kind,
        path,
        content,
        expectedHash: null,
        confirm: true,
      }),
    );
  return { near, far, repo, write };
}

const HOOKS =
  "hooks:\n  PreToolUse:\n    - matcher: Bash\n      hooks:\n        - type: command\n          command: touch ran\n";
const agent = (extra: string) => `---\nname: revisor\ndescription: reviews\n${extra}---\nBody.\n`;

describe("writing an agent, a skill or a CLAUDE.md needs a near connection (#3815)", () => {
  test("a far connection cannot write an agent with hooks and the file is not made; a near one can", async () => {
    const { near, far, repo, write } = await nearAndFar();
    const path = ".claude/agents/revisor.md";
    const farWrite = await write(far, "agent", path, agent(HOOKS));
    const afterFar = existsSync(join(repo, path));
    const nearWrite = await write(near, "agent", path, agent(HOOKS));
    expect([farWrite, afterFar, nearWrite, existsSync(join(repo, path))]).toEqual([
      "transport_refused",
      false,
      null,
      true,
    ]);
  });

  test("a far connection cannot write a skill, an agent without hooks or a CLAUDE.md either", async () => {
    const { far, repo, write } = await nearAndFar();
    const targets: Array<[string, string, string]> = [
      ["skill", ".claude/skills/audit/SKILL.md", agent(HOOKS)],
      ["skill", ".claude/skills/plain/SKILL.md", agent("")],
      ["agent", ".claude/agents/plain.md", agent("tools: Read\n")],
      ["claudemd", "CLAUDE.md", "Be careful.\n"],
    ];
    const reasons: Array<string | null> = [];
    for (const [kind, path, content] of targets)
      reasons.push(await write(far, kind, path, content));
    expect([reasons, targets.some(([, path]) => existsSync(join(repo, path)))]).toEqual([
      Array(4).fill("transport_refused"),
      false,
    ]);
  });
});
