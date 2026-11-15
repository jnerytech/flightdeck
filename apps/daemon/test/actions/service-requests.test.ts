import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { VaultRequestFrame } from "@flightdeck/protocol";
import { Actions, type ActionsFrame } from "../../src/actions/actions.ts";
import {
  BASE64,
  echoDef,
  failure,
  HEX,
  runCleanups,
  setup,
  VALUE,
} from "../support/actions-service.ts";
import { poll } from "../support/helpers.ts";

afterEach(runCleanups);

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
