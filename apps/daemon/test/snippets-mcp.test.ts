import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runCli } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { SecretScanner } from "../src/snippets/model.ts";
import { Snippets } from "../src/snippets/store.ts";
import { EventStore } from "../src/store/event-store.ts";
import { newManager, tempDir, workspace } from "./helpers.ts";

setDefaultTimeout(20_000);

const TOKEN = "snippets-mcp-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const SPEC_FILE = `- name: testes-rapidos
  type: command
  run: "bun test {{arquivo}}"
  vars: { arquivo: { default: "" } }
- name: revisar-seguranca
  type: prompt
  text: "Revise {{file}} procurando injeção, segredos expostos e validação faltando. Responda em tópicos."
`;

/** A daemon (in process) with snippets, and `flightdeckd mcp` pointed at it. */
async function setup(options: { snippets?: boolean; cwd?: "project" | "outside" } = {}) {
  const { root, project } = workspace();
  const store = new EventStore(":memory:");
  const snippets = new Snippets({
    db: store.db,
    allowedRoots: [root],
    scanner: new SecretScanner(),
  });
  const server = startServer({
    manager: newManager().manager,
    ...(options.snippets === false ? {} : { snippets }),
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
  });
  cleanups.push(() => server.stop());
  const file = join(tempDir(), "config.json");
  writeFileSync(
    file,
    JSON.stringify({ token: TOKEN, port: server.port, dataDir: join(tempDir(), "data") }),
  );
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await runCli(["mcp", "--config", file], {
    env: {},
    log: { log: () => {}, error: () => {} },
    exit: () => {},
    onSignal: () => {},
    mcpTransport: serverSide,
    cwd: options.cwd === "outside" ? tempDir() : project,
  });
  const client = new Client({ name: "teste", version: "1.0.0" });
  await client.connect(clientSide);
  cleanups.push(() => client.close());
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    try {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as Array<{ text?: string }>)[0]?.text ?? "";
      return result.isError ? { error: text } : { data: JSON.parse(text) };
    } catch (error) {
      return { error: (error as Error).message };
    }
  };
  mkdirSync(join(project, ".flightdeck"), { recursive: true });
  writeFileSync(join(project, ".flightdeck", "snippets.yaml"), SPEC_FILE);
  snippets.save({
    scope: "host",
    name: "status",
    type: "command",
    run: "git status",
    tags: ["git"],
  });
  snippets.save({
    scope: "project",
    projectPath: project,
    name: "build",
    type: "command",
    run: "bun run build",
  });
  return { root, project, snippets, client, call };
}

const names = (data: { snippets: Array<{ name: string }> }) =>
  data.snippets.map((s) => s.name).sort();

describe("snippets-mcp", () => {
  test("o MCP ganha list_snippets e get_snippet, e nenhuma ferramenta que cole, rode ou use um snippet", async () => {
    const { client } = await setup();
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toContain("list_snippets");
    expect(tools).toContain("get_snippet");
    // The Flightdeck runs nothing for Claude: it only reads.
    expect(tools.filter((name) => /snippet/.test(name)).sort()).toEqual([
      "get_snippet",
      "list_snippets",
    ]);
    // Phase 17's run_action and run_with_secret run declared actions, not snippets.
    const actions = new Set(["run_action", "run_with_secret"]);
    expect(
      tools.filter((name) => !actions.has(name)).some((name) => /paste|run_|use_|exec/.test(name)),
    ).toBe(false);
  });

  test("list_snippets devolve os do host e os do projeto (do daemon e do arquivo), com o texto e os campos", async () => {
    const { call, project } = await setup();
    const listed = await call("list_snippets", { projectPath: project });
    expect(names(listed.data)).toEqual(["build", "revisar-seguranca", "status", "testes-rapidos"]);
    const testes = listed.data.snippets.find((s: { name: string }) => s.name === "testes-rapidos");
    expect(testes).toMatchObject({
      type: "command",
      source: "file",
      run: "bun test {{arquivo}}",
      fields: [{ name: "arquivo" }],
      runnable: false,
    });
    expect(listed.data.file).toMatchObject({ trusted: false });
    // Filters: by text, tag and type.
    expect(
      names((await call("list_snippets", { projectPath: project, query: "seguranca" })).data),
    ).toEqual(["revisar-seguranca"]);
    expect(names((await call("list_snippets", { projectPath: project, tag: "git" })).data)).toEqual(
      ["status"],
    );
    expect(
      names((await call("list_snippets", { projectPath: project, type: "prompt" })).data),
    ).toEqual(["revisar-seguranca"]);
  });

  test("sem projectPath vale o diretório do Claude, e fora das pastas permitidas só os do host", async () => {
    const inside = await setup();
    expect(names((await inside.call("list_snippets")).data)).toEqual([
      "build",
      "revisar-seguranca",
      "status",
      "testes-rapidos",
    ]);
    const outside = await setup({ cwd: "outside" });
    expect(names((await outside.call("list_snippets")).data)).toEqual(["status"]);
    // An explicit folder the daemon does not allow is an error, not a quiet fallback.
    const refused = await outside.call("list_snippets", {
      projectPath: join(outside.root, "..", "x"),
    });
    expect(refused.error).toMatch(/forbidden_cwd|permitid|inexistente/);
  });

  test("get_snippet devolve o texto pelo nome: o do host, o do projeto e o do arquivo", async () => {
    const { call, project } = await setup();
    expect((await call("get_snippet", { name: "status" })).data).toMatchObject({
      type: "command",
      run: "git status",
      scope: "host",
    });
    expect((await call("get_snippet", { name: "build", projectPath: project })).data).toMatchObject(
      {
        run: "bun run build",
        scope: "project",
      },
    );
    const prompt = await call("get_snippet", { name: "revisar-seguranca" });
    expect(prompt.data).toMatchObject({
      type: "prompt",
      text: expect.stringContaining("Revise {{file}}"),
      fields: [{ name: "file", special: true }],
    });
    expect((await call("get_snippet", { name: "nao-existe" })).error).toMatch(/não encontrado/);
  });

  test("ler não é usar: nada é executado, colado nem contado, e a confiança do arquivo continua como estava", async () => {
    const { call, snippets, project } = await setup();
    await call("list_snippets", { projectPath: project });
    await call("get_snippet", { name: "testes-rapidos" });
    await call("get_snippet", { name: "status" });
    expect(
      snippets
        .list({ projectPath: project })
        .snippets.every((s) => s.uses === 0 && s.lastUsedAt === null),
    ).toBe(true);
    expect(snippets.list({ projectPath: project }).file?.trusted).toBe(false);
  });

  test("sem os snippets no daemon, a ferramenta diz o erro", async () => {
    const { call } = await setup({ snippets: false });
    expect((await call("list_snippets")).error).toMatch(/snippets is off on this host/);
    expect((await call("get_snippet", { name: "x" })).error).toMatch(
      /snippets is off on this host/,
    );
  });
});
