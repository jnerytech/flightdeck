import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Actions } from "../src/actions/actions.ts";
import { runCli } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { Vault } from "../src/vault/vault.ts";
import { git, gitRepo } from "./board-helpers.ts";
import { newManager, poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

setDefaultTimeout(20_000);

const TOKEN = "acoes-mcp-token-0123456789abcdef";
const VALUE = "tok_SEGREDO-DE-TESTE-7d2f9a";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const echoDef = {
  name: "echo",
  description: "imprime o token",
  run: [process.execPath, "-e", "console.log(process.env.TOKEN)"],
  env: { TOKEN: "{{secret.token}}" },
};
const sayDef = {
  name: "diz",
  description: "diz uma palavra",
  run: [process.execPath, "-e", "console.log(process.argv[1])", "{{param.palavra}}"],
  params: { palavra: { pattern: "^[a-z]{1,8}$", default: "oi" } },
};

type Frame = { requestId: string; secretId: string; purpose: string } & Record<string, unknown>;

/** A daemon with the actions service, the app watching it, and `flightdeckd mcp` pointed at it. */
async function setup(options: { requestTimeoutMs?: number; watching?: boolean } = {}) {
  const { manager } = newManager();
  const { repo } = gitRepo();
  const store = new EventStore(":memory:");
  const vault = new Vault({ log: () => {} });
  const actions = new Actions({
    db: store.db,
    vault,
    hostBase: tempDir("fd-host-"),
    requestTimeoutMs: options.requestTimeoutMs ?? 3000,
    projects: () => ({ id: "p1", path: repo, baseBranch: "main" }),
  });
  const server = startServer({
    manager,
    vault,
    actions,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [],
  });
  cleanups.push(() => {
    server.stop();
    actions.stop();
    vault.stop();
  });
  await actions.save({ projectId: "p1", definition: echoDef });
  await actions.save({ projectId: "p1", definition: sayDef });

  const app = new FrameClient(server.url);
  cleanups.push(() => app.close());
  await app.request("hello", { token: TOKEN, client: "app" });
  if (options.watching !== false) await app.request("vault.watch", {});
  const requests = () => app.frames.filter((f) => f.type === "vault.request") as Frame[];
  /** The user approving: delivers the value for the purpose the request carries. */
  const approve = (frame: Frame) =>
    app.request("vault.deliver", {
      secretId: frame.secretId,
      value: VALUE,
      purpose: frame.purpose,
      expiresAt: Date.now() + 30_000,
      requester: "claude",
    });

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
  return { call, client, app, requests, approve, repo, actions };
}

describe("mcp-acoes", () => {
  test("list_actions mostra nome, descrição e parâmetros com padrão e default, sem segredo nenhum", async () => {
    const { call } = await setup();
    const listed = await call("list_actions", { projectId: "p1" });
    expect(listed.data).toEqual({
      actions: [
        {
          name: "diz",
          description: "diz uma palavra",
          approval: "never",
          params: { palavra: { pattern: "^[a-z]{1,8}$", default: "oi" } },
        },
        { name: "echo", description: "imprime o token", approval: "first-per-session", params: {} },
      ],
    });
    const text = JSON.stringify(listed);
    for (const hidden of ["token", "TOKEN", "env", "secret", "hash", "run"]) {
      expect(text).not.toContain(`"${hidden}"`);
    }
  });

  test("list_actions só traz o que pode rodar: a versionada sem confiança fica de fora", async () => {
    const { call, repo } = await setup();
    mkdirSync(join(repo, ".flightdeck"), { recursive: true });
    writeFileSync(
      join(repo, ".flightdeck", "actions.yaml"),
      JSON.stringify([{ name: "nova", description: "x", run: ["echo", "oi"] }]),
    );
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "ações");
    const listed = await call("list_actions", { projectId: "p1" });
    expect(((listed.data?.actions ?? []) as Array<{ name: string }>).map((a) => a.name)).toEqual([
      "diz",
      "echo",
    ]);
    // Without a project, the host's actions: there are none.
    expect((await call("list_actions")).data).toEqual({ actions: [] });
  });

  test("run_action: o app aprova, o segredo vai para a ação e o Claude recebe a saída mascarada", async () => {
    const { call, requests, approve } = await setup();
    const running = call("run_action", { projectId: "p1", name: "echo" });
    const frame = (await poll(() => requests()[0])) as Frame;
    expect(frame).toMatchObject({
      requester: "claude",
      action: "echo",
      approval: "first-per-session",
    });
    await approve(frame);
    const done = await running;
    expect(done.data).toMatchObject({ exitCode: 0, output: "•••(token)\n", timedOut: false });
    expect(JSON.stringify(done)).not.toContain(VALUE);
  });

  test("run_action com parâmetros: valem o padrão; fora do padrão volta como erro e nada é pedido ao app", async () => {
    const { call, requests } = await setup();
    expect((await call("run_action", { projectId: "p1", name: "diz" })).data?.output).toBe("oi\n");
    expect(
      (await call("run_action", { projectId: "p1", name: "diz", params: { palavra: "ola" } })).data
        ?.output,
    ).toBe("ola\n");
    const refused = await call("run_action", {
      projectId: "p1",
      name: "diz",
      params: { palavra: "OLA; rm" },
    });
    expect(refused.error).toContain("bad_request");
    expect((await call("run_action", { projectId: "p1", name: "nada" })).error).toContain(
      "not_found",
    );
    expect(requests()).toEqual([]);
  });

  test("run_with_secret sempre pede aprovação: o frame leva o comando, os segredos e o approval always", async () => {
    const { call, requests, approve } = await setup();
    const command = `bun -e "console.log(process.env.DEPLOY_TOKEN)"`;
    const running = call("run_with_secret", { command, secrets: ["deploy-token"] });
    const frame = (await poll(() => requests()[0])) as Frame;
    expect(frame).toMatchObject({
      approval: "always",
      command,
      secrets: ["deploy-token"],
      requester: "claude",
    });
    await approve(frame);
    const done = await running;
    expect(done.data).toMatchObject({ exitCode: 0, output: "•••(deploy-token)\n" });
  });

  test("run_with_secret sem aprovação não roda: recusado, sem resposta ou sem o app, o comando não executa", async () => {
    const denied = await setup();
    const marker = join(denied.repo, "rodou.txt");
    const command = `bun -e "require('node:fs').writeFileSync(process.argv[1], 'x')" "${marker.replaceAll("\\", "/")}"`;
    const running = denied.call("run_with_secret", { command, secrets: ["tok"] });
    const frame = (await poll(() => denied.requests()[0])) as Frame;
    await denied.app.request("vault.deny", { requestId: frame.requestId });
    expect((await running).error).toContain("recusou");

    const silent = await setup({ requestTimeoutMs: 150 });
    expect((await silent.call("run_with_secret", { command, secrets: ["tok"] })).error).toContain(
      "invalid_state",
    );

    const alone = await setup({ watching: false });
    expect((await alone.call("run_with_secret", { command, secrets: ["tok"] })).error).toContain(
      "app",
    );
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(silent.repo, "rodou.txt"))).toBe(false);
  });

  test("o host de run_with_secret que não é este fica para a Fase 15", async () => {
    const { call } = await setup();
    const remote = await call("run_with_secret", { command: "ls", secrets: ["a"], host: "vps" });
    expect(remote.error).toContain("Fase 15");
  });
});
