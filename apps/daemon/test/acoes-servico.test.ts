import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { VaultRequestFrame, VaultUsed } from "@flightdeck/protocol";
import { Actions, type ActionsFrame, type ActionsOptions } from "../src/actions/actions.ts";
import { FlightdeckError } from "../src/errors.ts";
import { EventStore } from "../src/store/event-store.ts";
import { Vault } from "../src/vault/vault.ts";
import { git, gitRepo } from "./board-helpers.ts";
import { poll, tempDir } from "./helpers.ts";

const VALUE = "tok_SEGREDO-DE-TESTE-7d2f9a";
const BASE64 = Buffer.from(VALUE).toString("base64");
const HEX = Buffer.from(VALUE).toString("hex");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const echoDef = (over: Record<string, unknown> = {}) => ({
  name: "echo",
  description: "imprime o token",
  run: [process.execPath, "-e", "console.log(process.env.TOKEN)"],
  env: { TOKEN: "{{secret.token}}" },
  ...over,
});

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    const why = (error as FlightdeckError).reason;
    return `${(error as FlightdeckError).code}: ${(error as Error).message}${why ? ` [${why}]` : ""}`;
  }
};

function setup(over: Partial<ActionsOptions> = {}) {
  const { repo } = gitRepo();
  const store = new EventStore(":memory:");
  const vault = new Vault({ log: () => {} });
  const hostBase = tempDir("fd-host-");
  const project = { id: "p1", path: repo, baseBranch: "main" };
  const actions = new Actions({
    db: store.db,
    vault,
    hostBase,
    requestTimeoutMs: 3000,
    projects: (id) => {
      if (id !== "p1") throw new FlightdeckError("not_found", `projeto ${id} não existe`);
      return project;
    },
    ...over,
  });
  const frames: ActionsFrame[] = [];
  const unwatch = actions.watch((frame) => frames.push(frame));
  cleanups.push(() => {
    unwatch();
    actions.stop();
    vault.stop();
  });
  const requests = () => frames.filter((f): f is VaultRequestFrame => f.type === "vault.request");
  const used = () => frames.filter((f): f is VaultUsed => f.type === "vault.used");
  /** What the app does on approving: delivers the value for the purpose the request carries. */
  const deliver = (frame: { secretId: string; purpose: string }, value = VALUE) =>
    vault.deliver(
      {
        secretId: frame.secretId,
        value,
        purpose: frame.purpose,
        expiresAt: Date.now() + 30_000,
        requester: "claude",
      },
      "127.0.0.1",
    );
  /** The app, approving every request as it comes. */
  const approveAll = () =>
    actions.watch((frame) => {
      if (frame.type === "vault.request") deliver(frame);
    });
  /** The app, as the user starting an action: delivers first, for the `you` purpose. */
  const deliverForYou = (name: string, secretId = "token", value = VALUE) =>
    vault.deliver(
      {
        secretId,
        value,
        purpose: `action:${name}:you`,
        expiresAt: Date.now() + 30_000,
        requester: "you",
      },
      "127.0.0.1",
    );
  return {
    actions,
    vault,
    store,
    repo,
    hostBase,
    project,
    frames,
    requests,
    used,
    deliver,
    approveAll,
    deliverForYou,
  };
}

/** Commits `.flightdeck/actions.yaml` (JSON is YAML) on main. */
function commitActions(repo: string, list: unknown, message = "ações") {
  mkdirSync(join(repo, ".flightdeck"), { recursive: true });
  writeFileSync(join(repo, ".flightdeck", "actions.yaml"), JSON.stringify(list));
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", message);
}

describe("acoes-servico: ações do app", () => {
  test("salva, lista e remove; o que o app cria já nasce confiado, no projeto e no host", async () => {
    const { actions } = setup();
    const saved = await actions.save({
      projectId: "p1",
      definition: echoDef(),
      secretIds: ["token"],
    });
    expect(saved).toMatchObject({
      name: "echo",
      description: "imprime o token",
      source: "app",
      projectId: "p1",
      approval: "first-per-session",
      secrets: { values: ["token"], files: [] },
      trusted: true,
      changed: [],
    });
    expect(saved.hash).toMatch(/^[0-9a-f]{64}$/);
    const host = await actions.save({
      definition: { name: "hora", description: "a hora", run: ["date"] },
    });
    expect(host).toMatchObject({ projectId: null, approval: "never", source: "app" });
    expect((await actions.list("p1")).actions.map((a) => a.name).sort()).toEqual(["echo", "hora"]);
    expect((await actions.list()).actions.map((a) => a.name)).toEqual(["hora"]);
    expect((await actions.remove("p1", "echo")).actions.map((a) => a.name)).toEqual(["hora"]);
    expect((await actions.remove(undefined, "hora")).actions).toEqual([]);
  });

  test("as tags da ação aparecem para o app, e mudar uma tag muda o que foi confiado", async () => {
    const { actions } = setup();
    const saved = await actions.save({
      projectId: "p1",
      definition: echoDef({ tags: ["prod"] }),
    });
    expect(saved.tags).toEqual(["prod"]);
    expect(saved.trusted).toBe(true);
    const plain = await actions.save({ projectId: "p1", definition: echoDef({ name: "outra" }) });
    expect(plain.tags).toEqual([]);
    // The tags are part of the declaration: a different one is a different hash.
    const retagged = await actions.save({
      projectId: "p1",
      definition: echoDef({ tags: ["staging"] }),
    });
    expect(retagged.hash).not.toBe(saved.hash);
  });

  test("salvar de novo troca a definição; parâmetros e padrão aparecem para o app", async () => {
    const { actions } = setup();
    await actions.save({ projectId: "p1", definition: echoDef() });
    const again = await actions.save({
      projectId: "p1",
      definition: echoDef({
        run: ["echo", "{{param.branch}}"],
        env: {},
        params: { branch: { pattern: "^[a-z]+$", default: "main" } },
        timeoutS: 30,
        cwd: "sub",
      }),
    });
    expect(again).toMatchObject({
      params: { branch: { pattern: "^[a-z]+$", default: "main" } },
      timeoutS: 30,
      cwd: "sub",
      secrets: { values: [], files: [] },
    });
    expect((await actions.list("p1")).actions).toHaveLength(1);
  });

  test("definição inválida, segredo desconhecido e projeto que não existe são recusados", async () => {
    const { actions } = setup();
    const bad = await failure(
      actions.save({ projectId: "p1", definition: echoDef({ run: "echo oi" }) }),
    );
    expect(bad).toContain("bad_request");
    const arg = await failure(
      actions.save({
        projectId: "p1",
        definition: echoDef({ run: ["curl", "-H", "{{secret.token}}"] }),
      }),
    );
    expect(arg).toContain("bad_request");
    expect(arg).toContain("argumento");
    const unknown = await failure(
      actions.save({ projectId: "p1", definition: echoDef(), secretIds: ["outro"] }),
    );
    expect(unknown).toContain("bad_request");
    expect(unknown).toContain("token");
    expect(await failure(actions.save({ projectId: "nao", definition: echoDef() }))).toContain(
      "not_found",
    );
    expect(await failure(actions.list("nao"))).toContain("not_found");
    expect(await failure(actions.remove("p1", "nada"))).toContain("not_found");
  });
});

describe("acoes-servico: ações versionadas e confiança", () => {
  test("vêm da branch base, nascem sem confiança e só rodam depois de confiar pelo hash", async () => {
    const { actions, repo, deliverForYou } = setup();
    commitActions(repo, [echoDef()]);
    const listed = (await actions.list("p1")).actions;
    expect(listed).toHaveLength(1);
    const info = listed[0] as (typeof listed)[number];
    expect(info).toMatchObject({ name: "echo", source: "versioned", trusted: false, changed: [] });
    deliverForYou("echo");
    const refused = await failure(
      actions.run({ projectId: "p1", name: "echo", requestedBy: "you" }),
    );
    expect(refused).toContain("invalid_state");
    expect(refused).toContain("is not trusted [action_not_trusted]");
    expect(await failure(actions.trust("p1", "echo", "0".repeat(64)))).toContain(
      "[action_changed_review]",
    );
    const trusted = await actions.trust("p1", "echo", info.hash);
    expect(trusted.trusted).toBe(true);
    const done = await actions.run({ projectId: "p1", name: "echo", requestedBy: "you" });
    expect(done.exitCode).toBe(0);
    expect(done.output).toContain("•••(token)");
  });

  test("só a branch base conta: o que está no disco ou em outra branch não aparece", async () => {
    const { actions, repo } = setup();
    expect((await actions.list("p1")).actions).toEqual([]);
    mkdirSync(join(repo, ".flightdeck"), { recursive: true });
    writeFileSync(join(repo, ".flightdeck", "actions.yaml"), JSON.stringify([echoDef()]));
    expect((await actions.list("p1")).actions).toEqual([]);
    git(repo, "checkout", "-q", "-b", "outra");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "só na outra");
    git(repo, "checkout", "-q", "main");
    expect((await actions.list("p1")).actions).toEqual([]);
  });

  test("o arquivo com erro entra em errors e as ações válidas continuam", async () => {
    const { actions, repo } = setup();
    commitActions(repo, [echoDef(), { name: "ruim", description: "x", run: "echo" }]);
    const listed = await actions.list("p1");
    expect(listed.actions.map((a) => a.name)).toEqual(["echo"]);
    expect(listed.errors.join(" ")).toContain("ruim");
  });

  test("mudar a declaração na base derruba a confiança e a execução é recusada", async () => {
    const { actions, repo, deliverForYou } = setup();
    commitActions(repo, [echoDef()]);
    const first = (await actions.list("p1")).actions[0] as { hash: string };
    await actions.trust("p1", "echo", first.hash);
    commitActions(repo, [echoDef({ timeoutS: 30 })], "mudou");
    const after = (await actions.list("p1")).actions[0] as { trusted: boolean; changed: string[] };
    expect(after.trusted).toBe(false);
    expect(after.changed).toEqual(["declaração"]);
    deliverForYou("echo");
    const refused = await failure(
      actions.run({ projectId: "p1", name: "echo", requestedBy: "you" }),
    );
    expect(refused).toContain("changed");
    expect(refused).toContain("declaração");
  });

  test("a ação do app com o mesmo nome vale no lugar da versionada", async () => {
    const { actions, repo } = setup();
    commitActions(repo, [echoDef({ description: "versionada" })]);
    await actions.save({ projectId: "p1", definition: echoDef({ description: "do app" }) });
    const listed = (await actions.list("p1")).actions;
    expect(listed.map((a) => [a.name, a.source, a.description])).toEqual([
      ["echo", "app", "do app"],
    ]);
  });

  test("a ação do projeto vale no lugar da do host de mesmo nome", async () => {
    const { actions } = setup();
    await actions.save({ definition: echoDef({ description: "do host" }) });
    await actions.save({ projectId: "p1", definition: echoDef({ description: "do projeto" }) });
    expect((await actions.list("p1")).actions.map((a) => a.description)).toEqual(["do projeto"]);
  });

  test("um script do argv alterado depois de confiar é recusado logo antes de executar, também no app", async () => {
    const { actions, repo, deliverForYou } = setup();
    mkdirSync(join(repo, "scripts"));
    const script = join(repo, "scripts", "deploy.ts");
    const marker = join(repo, "rodou.txt");
    writeFileSync(script, "console.log(process.env.TOKEN)\n");
    await actions.save({
      projectId: "p1",
      definition: echoDef({ run: [process.execPath, "scripts/deploy.ts"] }),
    });
    deliverForYou("echo");
    const ok = await actions.run({ projectId: "p1", name: "echo", requestedBy: "you" });
    expect(ok.output).toContain("•••(token)");

    writeFileSync(
      script,
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x"); console.log(process.env.TOKEN)\n`,
    );
    const info = (await actions.list("p1")).actions[0] as { trusted: boolean; changed: string[] };
    expect(info.changed).toEqual(["scripts/deploy.ts"]);
    expect(info.trusted).toBe(false);
    deliverForYou("echo");
    const refused = await failure(
      actions.run({ projectId: "p1", name: "echo", requestedBy: "you" }),
    );
    expect(refused).toContain("scripts/deploy.ts");
    expect(existsSync(marker)).toBe(false);

    // Trusting again takes the hash the app shows, and then it runs.
    const fresh = (await actions.list("p1")).actions[0] as { hash: string };
    await actions.trust("p1", "echo", fresh.hash);
    deliverForYou("echo");
    const again = await actions.run({ projectId: "p1", name: "echo", requestedBy: "you" });
    expect(again.exitCode).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });

  test("o script que muda enquanto o app decide é recusado logo antes de executar, e nada roda", async () => {
    const { actions, repo, requests, deliver } = setup();
    mkdirSync(join(repo, "scripts"));
    const script = join(repo, "scripts", "deploy.ts");
    const marker = join(repo, "rodou.txt");
    writeFileSync(script, "console.log(process.env.TOKEN)\n");
    await actions.save({
      projectId: "p1",
      definition: echoDef({ run: [process.execPath, "scripts/deploy.ts"] }),
    });
    const running = failure(actions.run({ projectId: "p1", name: "echo", requestedBy: "claude" }));
    const frame = (await poll(() => requests()[0])) as VaultRequestFrame;
    // The agent edits the script while the user reads the request.
    writeFileSync(
      script,
      `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x"); console.log(process.env.TOKEN)\n`,
    );
    deliver(frame);
    const error = await running;
    expect(error).toContain("invalid_state");
    expect(error).toContain("scripts/deploy.ts");
    expect(existsSync(marker)).toBe(false);
  });

  test("confiar numa ação que não existe falha", async () => {
    const { actions } = setup();
    expect(await failure(actions.trust("p1", "nada", "abc"))).toContain("not_found");
  });
});

describe("acoes-servico: execução", () => {
  test("o dono do app entrega antes: o valor vai para o ambiente, a saída volta mascarada e o cofre fica vazio", async () => {
    const { actions, vault, deliverForYou } = setup();
    await actions.save({ projectId: "p1", definition: echoDef() });
    deliverForYou("echo");
    const done = await actions.run({ projectId: "p1", name: "echo", requestedBy: "you" });
    expect(done).toMatchObject({ exitCode: 0, timedOut: false, truncated: false });
    expect(done.output).toBe("•••(token)\n");
    expect(done.runId).toMatch(/^[0-9A-Z]{26}$/);
    expect(done.durationMs).toBeGreaterThanOrEqual(0);
    expect(vault.held()).toBe(0);
  });

  test("sem o segredo entregue, a ação do app não roda", async () => {
    const { actions } = setup();
    await actions.save({ projectId: "p1", definition: echoDef() });
    const error = await failure(actions.run({ projectId: "p1", name: "echo", requestedBy: "you" }));
    expect(error).toContain("not_found");
    expect(error).toContain("token");
  });

  test("os parâmetros valem o padrão; o que não casa é recusado antes de pedir o segredo", async () => {
    const { actions, requests } = setup();
    await actions.save({
      projectId: "p1",
      definition: {
        name: "ola",
        description: "diz olá",
        run: [process.execPath, "-e", "console.log(process.argv[1])", "{{param.quem}}"],
        params: { quem: { pattern: "^[a-z]{1,8}$", default: "mundo" } },
      },
    });
    const run = (params?: Record<string, string>) =>
      actions.run({
        projectId: "p1",
        name: "ola",
        ...(params ? { params } : {}),
        requestedBy: "claude",
      });
    expect((await run()).output.trim()).toBe("mundo");
    expect((await run({ quem: "ana" })).output.trim()).toBe("ana");
    for (const bad of [{ quem: "ANA;rm" }, { outro: "x" }] as Array<Record<string, string>>) {
      expect(await failure(run(bad))).toContain("bad_request");
    }
    expect(requests()).toEqual([]);
  });

  test("ação sem projeto roda na pasta do host; uma que não existe é not_found", async () => {
    const { actions, hostBase } = setup();
    await actions.save({
      definition: {
        name: "onde",
        description: "pasta",
        run: [process.execPath, "-e", "console.log(process.cwd())"],
      },
    });
    const done = await actions.run({ name: "onde", requestedBy: "you" });
    expect(done.output.trim().toLowerCase()).toBe(hostBase.toLowerCase());
    expect(await failure(actions.run({ name: "nada", requestedBy: "you" }))).toContain("not_found");
    expect(
      await failure(actions.run({ projectId: "p1", name: "nada", requestedBy: "you" })),
    ).toContain("not_found");
  });

  test("a ação por ssh vai pelo executor da Fase 15, e sem ele é recusada", async () => {
    const jobs: Array<{ target: string; argv: string[]; env: Record<string, string> }> = [];
    const withSsh = setup({
      ssh: async (job) => {
        jobs.push({ target: job.target, argv: job.argv, env: job.env });
        return { exitCode: 0, stdout: `${job.env.TOKEN}\n`, stderr: "" };
      },
    });
    const def = {
      name: "logs",
      description: "logs",
      ssh: "prod-api",
      run: ["journalctl", "-n", "5"],
      env: { TOKEN: "{{secret.token}}" },
    };
    await withSsh.actions.save({ projectId: "p1", definition: def });
    withSsh.deliverForYou("logs");
    const done = await withSsh.actions.run({ projectId: "p1", name: "logs", requestedBy: "you" });
    expect(done.output).toBe("•••(token)\n");
    expect(jobs).toEqual([
      { target: "prod-api", argv: ["journalctl", "-n", "5"], env: { TOKEN: VALUE } },
    ]);

    const without = setup();
    await without.actions.save({ projectId: "p1", definition: def });
    without.deliverForYou("logs");
    expect(
      await failure(without.actions.run({ projectId: "p1", name: "logs", requestedBy: "you" })),
    ).toContain("ssh destination");
  });
});

describe("acoes-servico: pedidos ao app", () => {
  test("o Claude pede e o daemon pergunta ao app: o frame leva a ação, os parâmetros e a aprovação, nunca o valor", async () => {
    const { actions, requests, deliver } = setup();
    await actions.save({
      projectId: "p1",
      definition: echoDef({
        approval: "always",
        run: [
          process.execPath,
          "-e",
          "console.log(process.env.TOKEN, process.argv[1])",
          "{{param.x}}",
        ],
        params: { x: { pattern: "^[a-z]+$", default: "a" } },
      }),
    });
    const running = actions.run({
      projectId: "p1",
      name: "echo",
      params: { x: "b" },
      requestedBy: "claude",
    });
    const frame = await poll(() => requests()[0]);
    expect(frame).toMatchObject({
      type: "vault.request",
      secretId: "token",
      requester: "claude",
      action: "echo",
      params: { x: "b" },
      approval: "always",
    });
    const request = frame as VaultRequestFrame;
    expect(request.requestId.length).toBeGreaterThan(10);
    expect(request.purpose).toBe(`action:echo:${request.requestId}`);
    expect(JSON.stringify(request)).not.toContain(VALUE);
    deliver(request);
    const done = await running;
    expect(done.output).toBe("•••(token) b\n");
  });

  test("um segredo que só vale para o pedido: o entregue para outro propósito não é usado", async () => {
    const { actions, requests, deliver, vault } = setup({ requestTimeoutMs: 150 });
    await actions.save({ projectId: "p1", definition: echoDef() });
    // The app delivered for its own run; Claude asking for the same action does not get it.
    deliver({ secretId: "token", purpose: "action:echo:you" });
    const error = await failure(
      actions.run({ projectId: "p1", name: "echo", requestedBy: "claude" }),
    );
    expect(error).toContain("invalid_state");
    expect(requests()).toHaveLength(1);
    expect(vault.held()).toBe(1);
  });

  test("um pedido por segredo, na ordem; o frame traz o de arquivo também", async () => {
    const { actions, requests, deliver } = setup();
    await actions.save({
      projectId: "p1",
      definition: {
        name: "dois",
        description: "dois segredos",
        run: [
          process.execPath,
          "-e",
          "console.log(process.env.A, require('node:fs').readFileSync(process.env.B_FILE, 'utf8'))",
        ],
        env: { A: "{{secret.um}}", B_FILE: "{{secretFile.dois}}" },
      },
    });
    const running = actions.run({ projectId: "p1", name: "dois", requestedBy: "automation" });
    const first = await poll(() => requests()[0]);
    expect(first).toMatchObject({
      secretId: "um",
      requester: "automation",
      approval: "first-per-session",
    });
    expect(requests()).toHaveLength(1);
    deliver(first as VaultRequestFrame, "valor-um-9f8e7d");
    const second = await poll(() => requests()[1]);
    expect(second).toMatchObject({ secretId: "dois" });
    deliver(second as VaultRequestFrame, "valor-dois-1a2b3c");
    const done = await running;
    expect(done.output).toBe("•••(um) •••(dois)\n");
  });

  test("sem o app conectado não há a quem pedir: falha na hora, sem esperar", async () => {
    const { store, vault, project } = setup();
    // Same database and vault, but nobody watching.
    const lone = new Actions({
      db: store.db,
      vault,
      projects: () => project,
      requestTimeoutMs: 5000,
    });
    await lone.save({ projectId: "p1", definition: echoDef() });
    const started = Date.now();
    const error = await failure(lone.run({ projectId: "p1", name: "echo", requestedBy: "claude" }));
    expect(error).toContain("invalid_state");
    expect(error).toContain("app");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("o app recusa: a execução falha na hora e nada roda", async () => {
    const { actions, requests, repo } = setup();
    const marker = join(repo, "rodou.txt");
    await actions.save({
      projectId: "p1",
      definition: echoDef({
        run: [
          process.execPath,
          "-e",
          `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x")`,
        ],
      }),
    });
    const running = failure(actions.run({ projectId: "p1", name: "echo", requestedBy: "claude" }));
    const frame = (await poll(() => requests()[0])) as VaultRequestFrame;
    actions.deny(frame.requestId);
    const error = await running;
    expect(error).toContain("invalid_state");
    expect(error).toContain("[action_secret_refused]");
    expect(existsSync(marker)).toBe(false);
    // Denying twice, or something that never existed, is harmless.
    actions.deny(frame.requestId);
    actions.deny("nada");
  });

  test("o app não responde: estoura o prazo e nada roda", async () => {
    const { actions } = setup({ requestTimeoutMs: 40 });
    await actions.save({ projectId: "p1", definition: echoDef() });
    const error = await failure(
      actions.run({ projectId: "p1", name: "echo", requestedBy: "claude" }),
    );
    expect(error).toContain("invalid_state");
    expect(error).toContain("token");
  });

  test("parar o serviço cancela quem espera", async () => {
    const { actions, requests } = setup();
    await actions.save({ projectId: "p1", definition: echoDef() });
    const running = failure(actions.run({ projectId: "p1", name: "echo", requestedBy: "claude" }));
    await poll(() => requests()[0]);
    actions.stop();
    const error = await running;
    expect(error).toContain("invalid_state");
    expect(error).toContain("cancelled");
  });

  test("quem não é do daemon nem pode pedir", async () => {
    const { actions, requests } = setup();
    await actions.save({ projectId: "p1", definition: echoDef() });
    const error = await failure(
      actions.run({
        projectId: "p1",
        name: "echo",
        requestedBy: "admin" as never,
      }),
    );
    expect(error).toContain("invalid_state");
    expect(requests()).toEqual([]);
  });

  test("approval never e sem segredo não pedem nada ao app", async () => {
    const { actions, requests } = setup();
    await actions.save({
      projectId: "p1",
      definition: {
        name: "oi",
        description: "oi",
        run: [process.execPath, "-e", "console.log('oi')"],
      },
    });
    const done = await actions.run({ projectId: "p1", name: "oi", requestedBy: "claude" });
    expect(done.output).toBe("oi\n");
    expect(requests()).toEqual([]);
  });
});

describe("acoes-servico: comando livre", () => {
  const COMMAND = `bun -e "console.log(process.env.DEPLOY_TOKEN)"`;

  test("o pedido leva o comando, os segredos e o host, e sempre pede aprovação", async () => {
    const { actions, requests, deliver } = setup();
    const running = actions.runFree({
      command: COMMAND,
      secrets: ["deploy-token"],
      requestedBy: "claude",
    });
    const frame = (await poll(() => requests()[0])) as VaultRequestFrame;
    expect(frame).toMatchObject({
      secretId: "deploy-token",
      requester: "claude",
      approval: "always",
      command: COMMAND,
      secrets: ["deploy-token"],
    });
    expect(frame.purpose).toBe(`run_with_secret:${frame.requestId}`);
    expect(frame.action).toBeUndefined();
    deliver(frame);
    const done = await running;
    expect(done.exitCode).toBe(0);
    expect(done.output).toBe("•••(deploy-token)\n");
  });

  test("recusado, o comando não roda", async () => {
    const { actions, requests, hostBase } = setup();
    const marker = join(hostBase, "rodou.txt");
    const running = failure(
      actions.runFree({
        command: `bun -e "require('node:fs').writeFileSync(process.argv[1], 'x')" "${marker}"`,
        secrets: ["deploy-token"],
        requestedBy: "workflow",
      }),
    );
    const frame = (await poll(() => requests()[0])) as VaultRequestFrame;
    actions.deny(frame.requestId);
    expect(await running).toContain("refused");
    expect(existsSync(marker)).toBe(false);
  });

  test("um host que não é este fica para a Fase 15, e quem não é do daemon é recusado, sem pedir nada", async () => {
    const { actions, requests } = setup();
    const remote = await failure(
      actions.runFree({ command: "ls", secrets: ["a"], host: "vps", requestedBy: "claude" }),
    );
    expect(remote).toContain("invalid_state");
    expect(remote).toContain("[action_ssh_host_unsupported]");
    const you = await failure(
      actions.runFree({ command: "ls", secrets: ["a"], requestedBy: "you" }),
    );
    expect(you).toContain("invalid_state");
    expect(requests()).toEqual([]);
    // "local" is this host.
    const here = actions.runFree({
      command: "ls",
      secrets: ["a"],
      host: "local",
      requestedBy: "claude",
    });
    const frame = (await poll(() => requests()[0])) as VaultRequestFrame;
    expect(frame.host).toBe("local");
    actions.deny(frame.requestId);
    expect(await failure(here)).toContain("refused");
  });
});

describe("acoes-servico: registros", () => {
  test("cada execução fica registrada com quem pediu, o código e a saída mascarada, e o valor não está em lugar nenhum", async () => {
    const { actions, store, deliverForYou, approveAll } = setup();
    await actions.save({
      projectId: "p1",
      definition: echoDef({
        run: [
          process.execPath,
          "-e",
          `const v = process.env.TOKEN; console.log(v); console.log(Buffer.from(v).toString("base64")); console.log(Buffer.from(v).toString("hex")); console.error(encodeURIComponent(v + " ç"))`,
        ],
      }),
    });
    deliverForYou("echo");
    await actions.run({ projectId: "p1", name: "echo", requestedBy: "you" });
    approveAll();
    await actions.run({ projectId: "p1", name: "echo", requestedBy: "claude" });
    const runs = actions.runs({ projectId: "p1" });
    expect(runs.map((r) => r.requestedBy)).toEqual(["claude", "you"]);
    expect(runs[0]).toMatchObject({ name: "echo", projectId: "p1", exitCode: 0, timedOut: false });
    expect(runs[0]?.output).toContain("•••(token)");
    expect(runs[0]?.startedAt).toMatch(/^\d{4}-\d\d-\d\dT/);

    // The lock: the value, in none of its forms, in any table of the database.
    const dump = JSON.stringify([
      store.db.query("SELECT * FROM action_runs").all(),
      store.db.query("SELECT * FROM actions").all(),
      store.db.query("SELECT * FROM action_trust").all(),
    ]);
    for (const form of [VALUE, BASE64, HEX, encodeURIComponent(VALUE)]) {
      expect(dump).not.toContain(form);
    }
    expect(JSON.stringify(runs)).not.toContain(VALUE);
  });

  test("o uso de cada segredo vira um frame vault.used, sem valor", async () => {
    const { actions, used, deliverForYou } = setup();
    await actions.save({ projectId: "p1", definition: echoDef() });
    deliverForYou("echo");
    await actions.run({ projectId: "p1", name: "echo", requestedBy: "you" });
    expect(used()).toHaveLength(1);
    expect(used()[0]).toMatchObject({
      type: "vault.used",
      secretId: "token",
      purpose: "action:echo",
      requester: "you",
      action: "run",
    });
    expect(JSON.stringify(used())).not.toContain(VALUE);
  });

  test("filtra por nome e por projeto, limita, e o histórico do comando livre usa o nome run_with_secret", async () => {
    const { actions, deliverForYou, approveAll, requests } = setup();
    await actions.save({ projectId: "p1", definition: echoDef() });
    await actions.save({
      definition: {
        name: "oi",
        description: "oi",
        run: [process.execPath, "-e", "console.log(1)"],
      },
    });
    deliverForYou("echo");
    await actions.run({ projectId: "p1", name: "echo", requestedBy: "you" });
    await actions.run({ name: "oi", requestedBy: "you" });
    await actions.run({ name: "oi", requestedBy: "you" });
    approveAll();
    await actions.runFree({
      command: `bun -e "console.log(process.env.X_TOKEN)"`,
      secrets: ["x-token"],
      requestedBy: "claude",
    });
    expect(requests()).toHaveLength(1);
    expect(actions.runs({}).map((r) => r.name)).toEqual(["run_with_secret", "oi", "oi", "echo"]);
    expect(actions.runs({ name: "oi" })).toHaveLength(2);
    expect(actions.runs({ projectId: "p1" }).map((r) => r.name)).toEqual(["echo"]);
    expect(actions.runs({ limit: 1 })).toHaveLength(1);
  });

  test("watch devolve como parar de receber", async () => {
    const { actions, deliverForYou } = setup();
    await actions.save({ projectId: "p1", definition: echoDef() });
    const seen: ActionsFrame[] = [];
    const stop = actions.watch((frame) => seen.push(frame));
    deliverForYou("echo");
    await actions.run({ projectId: "p1", name: "echo", requestedBy: "you" });
    expect(seen).toHaveLength(1);
    stop();
    deliverForYou("echo");
    await actions.run({ projectId: "p1", name: "echo", requestedBy: "you" });
    expect(seen).toHaveLength(1);
  });
});
