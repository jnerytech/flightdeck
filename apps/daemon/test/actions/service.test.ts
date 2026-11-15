import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { VaultRequestFrame } from "@flightdeck/protocol";
import { commitActions, echoDef, failure, runCleanups, setup } from "../support/actions-service.ts";
import { git } from "../support/board-helpers.ts";
import { poll } from "../support/helpers.ts";

afterEach(runCleanups);

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
    expect(arg).toContain("argument");
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
    expect(refused).toContain("[action_not_trusted]");
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
