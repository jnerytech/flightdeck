import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cardWhen } from "./board-helpers.ts";
import { poll, record } from "./helpers.ts";
import { workflowCard } from "./workflow-helpers.ts";

// Real git in temp repositories and several turns per test: more than the default 5 s.
setDefaultTimeout(20_000);

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

async function setup(yaml: string, options: Parameters<typeof workflowCard>[1] = {}) {
  const ctx = await workflowCard(yaml, options);
  boards.push(ctx.board);
  return ctx;
}

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: { code?: string; message?: string }) => `${error.code}: ${error.message}`,
  );

const PLAN = `inputs: [task]
steps:
  - id: plan
    agent: { prompt: "Planeje: {{inputs.task}}", permissionMode: plan }
`;

describe("engine-agent", () => {
  test("etapa agent abre sessão na worktree, com o prompt interpolado e o modo da etapa", async () => {
    const { board, manager, card, start, runWhen } = await setup(PLAN);
    await start({ task: "somar" });
    const run = await runWhen((r) => r.status === "completed");
    expect(run?.steps).toMatchObject([
      {
        stepId: "plan",
        attempt: 1,
        type: "agent",
        status: "completed",
        output: "Echo: Planeje: somar",
      },
    ]);
    const done = board.getCard(card.id);
    const session = manager.get(run?.steps[0]?.sessionId ?? "");
    expect(session.cwd).toBe(done.worktreePath ?? "?");
    expect(session.permissionMode).toBe("plan");
    // Only the step's session: the card's description is not sent to any agent.
    expect(manager.list().map((s) => s.id)).toEqual([session.id]);
    expect(done.column).toBe("review");
    expect(run?.endedAt).not.toBeNull();
  });

  test("a saída junta os textos de todas as mensagens do turno, na ordem", async () => {
    const yaml = "steps:\n  - id: a\n    agent: { prompt: '[tool] faça' }\n";
    const { board, card, start, runWhen, allow } = await setup(yaml);
    await start();
    const asking = await runWhen((r) => r.steps[0]?.sessionId != null);
    const waiting = await cardWhen(board, card.id, (c) => c.column === "waiting");
    expect(waiting?.column).toBe("waiting");
    allow(asking?.steps[0]?.sessionId);
    const run = await runWhen((r) => r.status === "completed");
    expect(run?.steps[0]?.output).toBe("Vou criar um arquivo.\n\nEcho: [tool] faça");
    expect(board.getCard(card.id).column).toBe("review");
  });

  test("continue manda a mensagem à sessão da etapa indicada", async () => {
    const yaml = [
      "steps:",
      "  - id: implement",
      "    agent: { prompt: implemente }",
      "  - id: fix",
      "    agent: { continue: implement, prompt: 'corrija: {{steps.implement.output}}' }",
    ].join("\n");
    const { manager, start, runWhen } = await setup(yaml);
    await start();
    const run = await runWhen((r) => r.status === "completed");
    const [implement, fix] = run?.steps ?? [];
    expect(fix?.sessionId).toBe(implement?.sessionId ?? "?");
    expect(fix?.output).toBe("Echo: corrija: Echo: implemente");
    expect(manager.list()).toHaveLength(1);
    const texts = record(manager, implement?.sessionId ?? "")
      .find("message.user")
      .map((e) => e.text);
    expect(texts).toEqual(["implemente", "corrija: Echo: implemente"]);
  });

  test("etapa que falha encerra a execução com o motivo e o card espera você", async () => {
    const yaml =
      "steps:\n  - id: a\n    agent: { prompt: '[fail]' }\n  - id: b\n    agent: { prompt: b }\n";
    const { board, card, start, runWhen } = await setup(yaml);
    await start();
    const run = await runWhen((r) => r.status === "failed");
    expect(run?.statusReason).toBe("etapa a falhou: falha simulada do runtime");
    expect(run?.steps.map((s) => [s.stepId, s.status])).toEqual([["a", "failed"]]);
    const waiting = await cardWhen(board, card.id, (c) => c.column === "waiting");
    expect(waiting?.column).toBe("waiting");
  });

  test("Parar interrompe a etapa em andamento, que falha", async () => {
    const yaml = "steps:\n  - id: a\n    agent: { prompt: '[tool] x' }\n";
    const { board, card, start, runWhen } = await setup(yaml);
    await start();
    await runWhen((r) => r.steps[0]?.sessionId != null);
    await cardWhen(board, card.id, (c) => c.column === "waiting");
    await board.stopCard(card.id);
    const run = await runWhen((r) => r.status === "failed");
    expect(run?.statusReason).toBe(
      "etapa a falhou: turno terminou com erro (error_during_execution)",
    );
  });

  test("inputs obrigatórios e desconhecidos são recusados no início", async () => {
    const { board, card, start } = await setup(PLAN);
    expect(await failure(start())).toBe("invalid_state: input obrigatório: task");
    expect(await failure(start({ task: "x", extra: "y" }))).toBe(
      "invalid_state: input desconhecido: extra",
    );
    expect(board.getCard(card.id).runs).toEqual([]);
  });

  test("preparação que falha encerra a execução sem abrir sessão", async () => {
    const { board, card, manager, start, runWhen } = await setup(PLAN, { setupScript: "exit 3" });
    await start({ task: "x" });
    const run = await runWhen((r) => r.status === "failed");
    expect(run?.statusReason ?? "").toStartWith("preparação falhou (código 3)");
    expect(manager.list()).toEqual([]);
    expect(board.getCard(card.id).column).toBe("waiting");
  });

  test("a execução segura a vaga do card até terminar", async () => {
    const yaml =
      "steps:\n  - id: a\n    agent: { prompt: a }\n  - id: b\n    agent: { prompt: '[tool] b' }\n";
    const { board, project, start, runWhen, allow } = await setup(yaml, {
      board: { maxParallelRuns: 1 },
    });
    await start();
    const asking = await runWhen((r) => r.steps[1]?.sessionId != null);
    const other = board.createCard(project.id, { title: "Outro", description: "oi" });
    await board.startCard(other.id);
    await Bun.sleep(50);
    expect(board.getCard(other.id)).toMatchObject({ queued: true, sessionId: null });
    allow(asking?.steps[1]?.sessionId);
    expect(await runWhen((r) => r.status === "completed")).not.toBeNull();
    const started = await cardWhen(board, other.id, (c) => c.sessionId !== null);
    expect(started?.queued).toBe(false);
  });

  test("concluir fecha as sessões das etapas; descartar apaga a execução", async () => {
    const { board, manager, card, project, start, runWhen } = await setup(PLAN);
    await start({ task: "x" });
    const run = await runWhen((r) => r.status === "completed");
    expect(run?.status).toBe("completed");
    await board.completeCard(card.id, true);
    expect(manager.get(run?.steps[0]?.sessionId ?? "").status).toBe("ended");
    const other = board.createCard(project.id, { title: "Outro", description: "oi" });
    await board.startCard(other.id, { workflow: "wf", inputs: { task: "y" } });
    const runId = board.getCard(other.id).workflowRunId ?? "";
    await cardWhen(board, other.id, (c) => c.column === "review");
    expect((await board.discardCard(other.id, true)).discarded).toBe(true);
    expect(() => board.workflows.getRun(runId)).toThrow(`execução ${runId} não existe`);
  });

  test("Parar um card de workflow na fila encerra a execução; o card inicia de novo", async () => {
    const { board, card, project, start, run } = await setup(PLAN, {
      board: { maxParallelRuns: 1 },
    });
    const holder = board.createCard(project.id, { title: "Segura", description: "[tool] x" });
    await board.startCard(holder.id);
    await cardWhen(board, holder.id, (c) => c.sessionStatus === "awaiting_permission");
    await start({ task: "x" });
    expect(board.getCard(card.id).queued).toBe(true);
    await board.stopCard(card.id);
    expect(run()).toMatchObject({ status: "failed", statusReason: "card parado antes de começar" });
    expect(run()?.endedAt).not.toBeNull();
    const again = await start({ task: "y" }).then(
      (c) => c.workflowRunId,
      (error: Error) => error.message,
    );
    expect(again).not.toBe("o card tem uma execução de workflow em andamento");
    expect(run()?.inputs).toEqual({ task: "y" });
  });

  test("Concluir no meio da execução a encerra, fecha o gate e libera a vaga do host", async () => {
    const yaml =
      "steps:\n  - id: a\n    agent: { prompt: '[tool] a' }\n  - id: ok\n    gate: { message: ok }\n";
    const { board, card, project, start, run, runWhen, allow, store } = await setup(yaml, {
      board: { maxParallelRuns: 1 },
    });
    await start();
    const asking = await runWhen(
      (r) => store.pendingPermissions(r.steps[0]?.sessionId ?? "").length > 0,
    );
    await board.completeCard(card.id, true);
    expect(run()).toMatchObject({
      status: "failed",
      statusReason: "execução encerrada com o card",
    });
    expect(run()?.steps.map((s) => s.status)).toEqual(["failed"]);
    const other = board.createCard(project.id, { title: "Outro", description: "oi" });
    await board.startCard(other.id);
    expect((await cardWhen(board, other.id, (c) => c.sessionId !== null))?.queued).toBe(false);
    // A gate still open when the card is discarded closes with it and cannot be answered.
    expect(asking).not.toBeNull();
    await board.completeCard(other.id, true);
    const gated = board.createCard(project.id, { title: "Gate", description: "x" });
    await board.startCard(gated.id, { workflow: "wf" });
    const runId = board.getCard(gated.id).workflowRunId ?? "";
    const step = await poll(() => {
      const first = board.workflows.getRun(runId).steps[0];
      return store.pendingPermissions(first?.sessionId ?? "").length > 0 ? first : null;
    }, 5000);
    allow(step?.sessionId);
    await poll(() => board.workflows.getRun(runId).status === "waiting", 5000);
    await board.completeCard(gated.id, true);
    expect(board.workflows.getRun(runId).steps.at(-1)?.status).toBe("failed");
    expect(() => board.workflows.respond(runId, "ok", 1, "approve")).toThrow("não está aberto");
  });
});
