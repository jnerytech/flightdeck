import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MASK, McpConfig } from "../src/agentcfg/mcp.ts";
import { FakeRuntime } from "../src/runtime/fake-runtime.ts";
import { startServer } from "../src/server.ts";
import { newBoard } from "./board-helpers.ts";
import { newManager, poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "mcp-token-0123456789abcdef";
const ECO = resolve(import.meta.dir, "fixtures/mcp/eco-server.ts");
const MUDO = resolve(import.meta.dir, "fixtures/mcp/mudo-server.ts");
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const sha = (path: string) =>
  new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A project with .mcp.json and settings.local.json, and a user ~/.claude.json elsewhere. */
function setup(timeoutMs?: number) {
  const project = tempDir("fd-mcp-");
  const marker = join(project, "subiu.txt");
  writeFileSync(
    join(project, ".mcp.json"),
    JSON.stringify({
      outra: "chave preservada",
      mcpServers: {
        eco: { command: process.execPath, args: [ECO], env: { TOKEN: "segredo" } },
        marcador: {
          command: process.execPath,
          args: ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`],
        },
        mudo: { command: process.execPath, args: [MUDO] },
      },
    }),
  );
  mkdirSync(join(project, ".claude"));
  writeFileSync(
    join(project, ".claude", "settings.local.json"),
    JSON.stringify({ permissions: { allow: ["Read"] }, disabledMcpjsonServers: ["mudo"] }),
  );
  const userConfigPath = join(tempDir("fd-user-"), ".claude.json");
  writeFileSync(
    userConfigPath,
    JSON.stringify({
      mcpServers: {
        remoto: {
          type: "http",
          url: "https://mcp.example.com",
          headers: { Authorization: "Bearer abc" },
        },
      },
      projects: { [project]: { mcpServers: { local: { command: "python", args: ["srv.py"] } } } },
    }),
  );
  const config = new McpConfig({ userConfigPath, ...(timeoutMs ? { timeoutMs } : {}) });
  return { project, marker, userConfigPath, config };
}

async function code(promise: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof promise === "function" ? promise() : promise);
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).message;
  }
}

describe("mcp-projeto", () => {
  test("lista com origem e só leitura; segredos mascarados; abrir a lista não sobe servidor", () => {
    const { config, project, marker } = setup();
    const list = config.list(project);
    expect(list.map((s) => [s.name, s.origin, s.readOnly, s.enabled])).toEqual([
      ["eco", "project", false, true],
      ["marcador", "project", false, true],
      ["mudo", "project", false, false],
      ["remoto", "user", true, true],
      ["local", "user-project", true, true],
    ]);
    expect(list[0]).toMatchObject({ transport: "stdio", env: { TOKEN: MASK } });
    expect(list[3]).toMatchObject({
      transport: "http",
      url: "https://mcp.example.com",
      headers: { Authorization: MASK },
    });
    expect(existsSync(marker)).toBe(false);
  });

  test("salvar e remover mesclam no .mcp.json preservando o resto; o ~/.claude.json nunca muda", async () => {
    const { config, project, userConfigPath } = setup();
    const user = sha(userConfigPath);
    expect(
      await code(() => config.save(project, { name: "novo", command: "bun", args: ["x"] }, false)),
    ).toBe("invalid_state");
    config.save(project, { name: "novo", command: "bun", args: ["x"], env: { A: "1" } }, true);
    const saved = json(join(project, ".mcp.json"));
    expect(saved.outra).toBe("chave preservada");
    expect(saved.mcpServers.novo).toEqual({ command: "bun", args: ["x"], env: { A: "1" } });
    // The other servers keep their real secrets.
    expect(saved.mcpServers.eco.env).toEqual({ TOKEN: "segredo" });
    config.remove(project, "marcador", true);
    expect(Object.keys(json(join(project, ".mcp.json")).mcpServers)).toEqual([
      "eco",
      "mudo",
      "novo",
    ]);
    expect(sha(userConfigPath)).toBe(user);
  });

  test("editar com o valor mascarado é recusado: o segredo tem de ser digitado de novo; servidor do usuário é só leitura", async () => {
    const { config, project } = setup();
    expect(
      await code(() =>
        config.save(project, { name: "eco", command: "x", env: { TOKEN: MASK } }, true),
      ),
    ).toBe("invalid_state");
    expect(await code(() => config.remove(project, "remoto", true))).toBe("invalid_state");
    expect(await code(() => config.save(project, { name: "remoto", url: "https://x" }, true))).toBe(
      "invalid_state",
    );
  });

  test("ligar e desligar pela lista do settings.local.json, preservando o resto", () => {
    const { config, project } = setup();
    const file = join(project, ".claude", "settings.local.json");
    config.toggle(project, "mudo", true, true);
    config.toggle(project, "eco", false, true);
    expect(json(file)).toEqual({
      permissions: { allow: ["Read"] },
      disabledMcpjsonServers: ["eco"],
      enabledMcpjsonServers: ["mudo"],
    });
    expect(config.list(project).find((s) => s.name === "eco")?.enabled).toBe(false);
  });

  test("testar: sem confirm só mostra o comando exato; com confirm lista as ferramentas; respeita o timeout", async () => {
    const { config, project, marker, userConfigPath } = setup();
    expect(await config.test(project, "marcador", false)).toEqual({
      preview: {
        command: process.execPath,
        args: ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`],
      },
    });
    expect(existsSync(marker)).toBe(false);
    expect(await config.test(project, "eco", true)).toEqual({
      tools: ["eco"],
      resources: ["nota"],
    });
    // A short limit only for the server that never answers: a real one needs time to start.
    const quick = new McpConfig({ userConfigPath, timeoutMs: 300 });
    const timedOut = await quick.test(project, "mudo", true).then(
      () => "respondeu",
      (error: Error) => error.message,
    );
    expect(timedOut).toBe("o servidor mudo não respondeu em 0.3 s");
  });

  test("sessão gerenciada viva: liga e desliga na hora pelo runtime", async () => {
    const runtime = new FakeRuntime({ delayMs: 1 });
    const { manager, project } = newManager({ runtime });
    const { sessionId } = manager.create({ cwd: project, prompt: "oi" });
    await poll(() => manager.get(sessionId).status === "idle", 3000);
    await manager.toggleMcpServer(sessionId, "eco", false);
    expect(runtime.mcpToggles).toEqual([{ name: "eco", enabled: false }]);
  });

  test("protocolo: mcp.list e mcp.test (prévia) por projeto", async () => {
    const { board, manager, repo } = newBoard();
    const projectId = await board.addProject({ path: repo });
    writeFileSync(
      join(repo, ".mcp.json"),
      JSON.stringify({ mcpServers: { eco: { command: process.execPath, args: [ECO] } } }),
    );
    const server = startServer({
      manager,
      board,
      mcp: new McpConfig({ userConfigPath: join(tempDir(), ".claude.json") }),
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
    const listed = await client.data<{ servers: Array<{ name: string }> }>("mcp.list", {
      projectId: projectId.id,
    });
    expect(listed?.servers.map((s) => s.name)).toEqual(["eco"]);
    expect(await client.data("mcp.test", { projectId: projectId.id, name: "eco" })).toEqual({
      preview: { command: process.execPath, args: [ECO] },
    });
  });
});
