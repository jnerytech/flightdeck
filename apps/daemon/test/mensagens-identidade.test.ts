import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runCli } from "../src/main.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { gitRepo } from "./board-helpers.ts";
import { newManager, poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "identidade-token-0123456789abcdef";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("mensagens-identidade: quem é a sessão", () => {
  test("uma sessão gerenciada sobe com o id dela no ambiente, para o MCP que ela abrir saber quem manda", () => {
    const runtime = new FakeRuntime({ delayMs: 1 });
    const { manager, project } = newManager({ runtime });
    const { sessionId } = manager.create({ cwd: project, prompt: "oi" });
    expect(runtime.starts[0]?.env.FLIGHTDECK_SESSION).toBe(sessionId);
  });

  test("a sessão retomada depois do reinício leva o mesmo id", async () => {
    const runtime = new FakeRuntime({ delayMs: 1 });
    const { manager, project } = newManager({ runtime });
    const { sessionId } = manager.create({ cwd: project, prompt: "oi" });
    await poll(() => manager.get(sessionId).status === "idle", 3000);
    await manager.close(sessionId);
    await manager.resume(sessionId);
    expect(runtime.starts.at(-1)?.env.FLIGHTDECK_SESSION).toBe(sessionId);
  });
});

describe("mensagens-identidade: o daemon montado pelo main", () => {
  test("duas sessões do mesmo projeto se falam pelo protocolo, e uma pergunta quem pode ver", async () => {
    const { root, repo } = gitRepo();
    const dir = tempDir("fd-main-msg-");
    const file = join(dir, "config.json");
    await Bun.write(
      file,
      JSON.stringify({
        hostName: "meu-host",
        port: 0,
        token: TOKEN,
        dataDir: join(dir, "data"),
        hooks: { port: 0 },
        allowedRoots: [root],
      }),
    );
    const daemon = await runCli(["--config", file, "--runtime", "fake"], {
      env: {},
      log: { log: () => {}, error: () => {} },
      exit: () => {},
      onSignal: () => {},
    });
    cleanups.push(() => daemon?.stop());
    const client = new FrameClient(daemon?.url ?? "");
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const a = await client.data<{ sessionId: string }>("session.create", {
      cwd: repo,
      prompt: "um",
    });
    const b = await client.data<{ sessionId: string }>("session.create", {
      cwd: repo,
      prompt: "dois",
    });
    // The poll helper takes synchronous checks only, so the wait is a loop.
    for (let i = 0; i < 100; i++) {
      const list = await client.data<{ sessions: Array<{ status: string }> }>("session.list", {});
      if (list?.sessions.length === 2 && list.sessions.every((s) => s.status === "idle")) break;
      await Bun.sleep(50);
    }
    const seen = await client.data<{ sessions: Array<{ address: string; receives: boolean }> }>(
      "messages.sessions",
      { as: { session: a?.sessionId } },
    );
    expect(seen?.sessions.map((s) => s.address)).toEqual([`meu-host/${b?.sessionId}`]);
    const sent = await client.data("messages.send", {
      as: { session: a?.sessionId },
      to: `meu-host/${b?.sessionId}`,
      text: "oi da outra",
    });
    expect(sent).toMatchObject({ status: "delivered" });
    const listed = await client.data<{ messages: Array<{ text: string }> }>("messages.list", {});
    expect(listed?.messages.map((m) => m.text)).toEqual(["oi da outra"]);
  });
});
