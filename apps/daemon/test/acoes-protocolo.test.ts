import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Actions } from "../src/actions/actions.ts";
import { runCli } from "../src/main.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { Vault } from "../src/vault/vault.ts";
import { gitRepo } from "./board-helpers.ts";
import { newManager, poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "acoes-token-0123456789abcdef";
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

function setup(options: { actions?: boolean } = {}) {
  const { manager } = newManager();
  const { repo } = gitRepo();
  const store = new EventStore(":memory:");
  const vault = new Vault({ log: () => {} });
  const actions = new Actions({
    db: store.db,
    vault,
    hostBase: tempDir("fd-host-"),
    requestTimeoutMs: 3000,
    projects: () => ({ id: "p1", path: repo, baseBranch: "main" }),
  });
  const server = startServer({
    manager,
    vault,
    ...(options.actions === false ? {} : { actions }),
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
  return { server, actions, vault };
}

async function connect(url: string) {
  const client = new FrameClient(url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  return client;
}

const requestsOf = (client: FrameClient) =>
  client.frames.filter((f) => f.type === "vault.request") as Array<{
    requestId: string;
    secretId: string;
    purpose: string;
  }>;

describe("acoes-protocolo", () => {
  test("sem o serviço de ações o daemon responde invalid_state", async () => {
    const { server } = setup({ actions: false });
    const client = await connect(server.url);
    for (const [type, payload] of [
      ["actions.list", {}],
      ["actions.runs", {}],
      ["vault.watch", {}],
      ["vault.deny", { requestId: "r1" }],
    ] as const) {
      expect(await client.request(type, payload)).toMatchObject({
        ok: false,
        error: { code: "invalid_state" },
      });
    }
  });

  test("salvar, listar, confiar de novo e remover pelo protocolo", async () => {
    const { server } = setup();
    const client = await connect(server.url);
    const saved = await client.data<{ name: string; trusted: boolean; hash: string }>(
      "actions.save",
      { projectId: "p1", definition: echoDef, secretIds: ["token"] },
    );
    expect(saved).toMatchObject({ name: "echo", trusted: true });
    const listed = await client.data<{ actions: Array<{ name: string }>; errors: string[] }>(
      "actions.list",
      { projectId: "p1" },
    );
    expect(listed?.actions.map((a) => a.name)).toEqual(["echo"]);
    expect(
      await client.data("actions.trust", { projectId: "p1", name: "echo", hash: saved?.hash }),
    ).toMatchObject({ trusted: true });
    expect(
      await client.request("actions.save", { projectId: "p1", definition: { name: "X" } }),
    ).toMatchObject({ ok: false, error: { code: "bad_request" } });
    const removed = await client.data<{ actions: unknown[] }>("actions.remove", {
      projectId: "p1",
      name: "echo",
    });
    expect(removed?.actions).toEqual([]);
  });

  test("o app assiste, o Claude pede, o app entrega pelo vault.deliver e a saída volta mascarada", async () => {
    const { server } = setup();
    const app = await connect(server.url);
    const claude = await connect(server.url);
    await app.data("actions.save", { projectId: "p1", definition: echoDef });
    expect(await app.request("vault.watch", {})).toMatchObject({ ok: true });

    const running = claude.request("actions.run", {
      projectId: "p1",
      name: "echo",
      requestedBy: "claude",
    });
    const request = await poll(() => requestsOf(app)[0]);
    expect(request).toMatchObject({ secretId: "token" });
    const asked = request as { requestId: string; secretId: string; purpose: string };
    expect(
      await app.request("vault.deliver", {
        secretId: asked.secretId,
        value: VALUE,
        purpose: asked.purpose,
        expiresAt: Date.now() + 30_000,
        requester: "claude",
      }),
    ).toMatchObject({ ok: true });
    const ack = (await running) as { ok: boolean; data: { output: string; exitCode: number } };
    expect(ack.ok).toBe(true);
    expect(ack.data).toMatchObject({ exitCode: 0, output: "•••(token)\n" });

    const used = await poll(() => app.frames.find((f) => f.type === "vault.used"), 2000);
    expect(used).toMatchObject({ secretId: "token", requester: "claude", action: "run" });
    // The one that did not watch gets no frame of the vault, and nobody gets the value.
    expect(claude.frames.some((f) => String(f.type).startsWith("vault."))).toBe(false);
    expect(JSON.stringify([app.frames, claude.frames, ack])).not.toContain(VALUE);

    const runs = await app.data<{ runs: Array<{ requestedBy: string; output: string }> }>(
      "actions.runs",
      { projectId: "p1", name: "echo", limit: 5 },
    );
    expect(runs?.runs).toHaveLength(1);
    expect(runs?.runs[0]).toMatchObject({ requestedBy: "claude", output: "•••(token)\n" });
  });

  test("vault.deny recusa o pedido em espera e o run falha na hora", async () => {
    const { server } = setup();
    const app = await connect(server.url);
    const claude = await connect(server.url);
    await app.data("actions.save", { projectId: "p1", definition: echoDef });
    await app.request("vault.watch", {});
    const running = claude.request("actions.run", {
      projectId: "p1",
      name: "echo",
      requestedBy: "claude",
    });
    const request = (await poll(() => requestsOf(app)[0])) as { requestId: string };
    expect(await app.request("vault.deny", { requestId: request.requestId })).toMatchObject({
      ok: true,
    });
    expect(await running).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });

  test("run_with_secret pelo protocolo: o frame leva o comando e o app aprova; quem diz ser you não é um pedido válido", async () => {
    const { server } = setup();
    const app = await connect(server.url);
    const claude = await connect(server.url);
    await app.request("vault.watch", {});
    const running = claude.request("actions.runFree", {
      command: `bun -e "console.log(process.env.DEPLOY_TOKEN)"`,
      secrets: ["deploy-token"],
      requestedBy: "claude",
    });
    const request = (await poll(() => requestsOf(app)[0])) as {
      secretId: string;
      purpose: string;
    };
    expect(app.frames.find((f) => f.type === "vault.request")).toMatchObject({
      approval: "always",
      command: `bun -e "console.log(process.env.DEPLOY_TOKEN)"`,
      secrets: ["deploy-token"],
    });
    await app.request("vault.deliver", {
      secretId: request.secretId,
      value: VALUE,
      purpose: request.purpose,
      expiresAt: Date.now() + 30_000,
      requester: "claude",
    });
    expect(await running).toMatchObject({ ok: true, data: { output: "•••(deploy-token)\n" } });
    expect(
      await claude.request("actions.runFree", {
        command: "ls",
        secrets: ["a"],
        requestedBy: "you",
      }),
    ).toMatchObject({ ok: false, error: { code: "bad_request" } });
  });

  test("quando o app fecha a conexão, o daemon deixa de ter a quem pedir", async () => {
    const { server } = setup();
    const app = await connect(server.url);
    const claude = await connect(server.url);
    await claude.data("actions.save", { projectId: "p1", definition: echoDef });
    await app.request("vault.watch", {});
    // Watching twice is one stream, not two.
    await app.request("vault.watch", {});
    app.close();
    await Bun.sleep(100);
    expect(
      await claude.request("actions.run", { projectId: "p1", name: "echo", requestedBy: "claude" }),
    ).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });
});

describe("acoes-protocolo: o daemon montado pelo main", () => {
  test("uma ação de projeto resolve o projeto cadastrado no board do daemon de verdade", async () => {
    const { root, repo } = gitRepo();
    const dir = tempDir("fd-main-");
    const file = join(dir, "config.json");
    await Bun.write(
      file,
      JSON.stringify({
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
    const project = await client.data<{ id: string }>("project.add", { path: repo });
    const projectId = project?.id ?? "";
    const saved = await client.data<{ name: string }>("actions.save", {
      projectId,
      definition: { name: "oi", description: "oi", run: ["echo", "oi"] },
    });
    expect(saved?.name).toBe("oi");
    const listed = await client.data<{ actions: Array<{ name: string }> }>("actions.list", {
      projectId,
    });
    expect(listed?.actions.map((a) => a.name)).toEqual(["oi"]);
    expect(await client.request("actions.list", { projectId: "nao-existe" })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  test("an ssh action goes to the phase 15 destinos: one that does not exist is named in the error", async () => {
    const { root, repo } = gitRepo();
    const dir = tempDir("fd-main-ssh-");
    const file = join(dir, "config.json");
    await Bun.write(
      file,
      JSON.stringify({
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
    const project = await client.data<{ id: string }>("project.add", { path: repo });
    const projectId = project?.id ?? "";
    // Another destino is there: the name has to match, not just any destino.
    await client.data("ssh.save", { name: "outro", host: "10.0.0.9", user: "deploy" });
    await client.data("actions.save", {
      projectId,
      definition: { name: "remoto", description: "remoto", ssh: "nao-existe", run: ["uptime"] },
    });
    expect(
      await client.request("actions.run", { projectId, name: "remoto", requestedBy: "you" }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "not_found",
        message: "destination nao-existe not found",
        reason: "ssh_target_unknown",
        params: { name: "nao-existe" },
      },
    });
  });
});

describe("acoes-protocolo: o daemon montado pelo main aplica as regras", () => {
  test("o pedido do Claude passa pelas regras com o host, o risco e a chave do projeto do daemon de verdade", async () => {
    const { root, repo } = gitRepo();
    const dir = tempDir("fd-main-regras-");
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
    const app = new FrameClient(daemon?.url ?? "");
    const claude = new FrameClient(daemon?.url ?? "");
    cleanups.push(() => app.close());
    cleanups.push(() => claude.close());
    for (const client of [app, claude])
      await client.request("hello", { token: TOKEN, client: "t" });
    const project = await app.data<{ id: string }>("project.add", { path: repo });
    const projectId = project?.id ?? "";
    await app.data("actions.save", {
      projectId,
      definition: {
        name: "segredo",
        description: "usa um segredo",
        run: [process.execPath, "-e", "console.log(1)"],
        env: { TOKEN: "{{secret.tok}}" },
      },
    });
    // A rule that matches only on what the daemon knows: its host name.
    await app.data("vault.rules.set", {
      secretId: "tok",
      rules: [
        { id: "deste-host", match: { host: "meu-host", requester: "claude" }, decision: "ask" },
      ],
    });
    await app.request("vault.watch", {});
    const running = claude.request("actions.run", {
      projectId,
      name: "segredo",
      requestedBy: "claude",
    });
    const request = (await poll(() => app.frames.find((f) => f.type === "vault.request"))) as {
      requestId: string;
      ruleId: string;
      decision: string;
    };
    expect(request).toMatchObject({ ruleId: "deste-host", decision: "ask" });
    await app.request("vault.deny", { requestId: request.requestId });
    expect(await running).toMatchObject({ ok: false, error: { code: "invalid_state" } });
  });
});
