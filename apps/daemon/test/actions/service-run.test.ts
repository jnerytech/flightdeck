import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { VaultRequestFrame } from "@flightdeck/protocol";
import { echoDef, failure, runCleanups, setup, VALUE } from "../support/actions-service.ts";
import { poll } from "../support/helpers.ts";

afterEach(runCleanups);

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
