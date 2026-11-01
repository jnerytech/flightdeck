import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cardWhen } from "./board-helpers.ts";
import { workflowCard } from "./workflow-helpers.ts";

// Real git in temp repositories and several turns per test: more than the default 5 s.
setDefaultTimeout(20_000);

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

const YAML = `inputs: [task]
steps:
  - id: plan
    agent: { prompt: "plano de {{inputs.task}}" }
  - id: approve
    gate: { message: "Aprovar o plano?", show: "{{steps.plan.output}}" }
  - id: implement
    agent: { prompt: "implemente: {{steps.approve.output}}" }
`;

async function atGate(
  yaml = YAML,
  options: Parameters<typeof workflowCard>[1] = {},
  inputs: Record<string, string> = { task: "somar" },
) {
  const ctx = await workflowCard(yaml, options);
  boards.push(ctx.board);
  await ctx.start(inputs);
  const run = await ctx.runWhen((r) => r.status === "waiting");
  const respond = (
    decision: "approve" | "reject",
    note?: string,
    stepId = "approve",
    attempt = 1,
  ) => ctx.board.workflows.respond(run?.id ?? "", stepId, attempt, decision, note);
  return { ...ctx, gate: run, respond };
}

const failure = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    return `${code}: ${message}`;
  }
};

describe("engine-gate", () => {
  test("gate pausa a execução e move o card para Esperando você", async () => {
    const { board, card, gate } = await atGate();
    expect(gate?.steps.map((s) => [s.stepId, s.status])).toEqual([
      ["plan", "completed"],
      ["approve", "waiting"],
    ]);
    expect(gate?.steps[1]).toMatchObject({
      type: "gate",
      message: "Aprovar o plano?",
      output: "Echo: plano de somar",
      note: null,
      endedAt: null,
    });
    expect((await cardWhen(board, card.id, (c) => c.column === "waiting"))?.column).toBe("waiting");
  });

  test("aprovado segue, com a nota como saída do gate", async () => {
    const { board, card, respond, runWhen } = await atGate();
    respond("approve", "capriche");
    const run = await runWhen((r) => r.status === "completed");
    expect(run?.steps[1]).toMatchObject({ status: "approved", note: "capriche" });
    expect(run?.steps[1]?.endedAt).not.toBeNull();
    expect(run?.steps[2]?.output).toBe("Echo: implemente: capriche");
    expect(board.getCard(card.id).column).toBe("review");
  });

  test("recusado encerra com rejected e o card espera você", async () => {
    const { board, card, respond, runWhen } = await atGate();
    respond("reject", "refaça");
    const run = await runWhen((r) => r.status === "rejected");
    expect(run?.statusReason).toBe("gate approve recusado: refaça");
    expect(run?.steps.map((s) => [s.stepId, s.status])).toEqual([
      ["plan", "completed"],
      ["approve", "rejected"],
    ]);
    expect(run?.endedAt).not.toBeNull();
    expect(board.getCard(card.id).column).toBe("waiting");
  });

  test("recusado sem nota; gate sem show tem saída vazia", async () => {
    const yaml = "steps:\n  - id: ok\n    gate: { message: 'Seguir?' }\n";
    const { respond, runWhen, gate } = await atGate(yaml, {}, {});
    expect(gate?.steps[0]).toMatchObject({ message: "Seguir?", output: null });
    respond("reject", undefined, "ok");
    expect((await runWhen((r) => r.status === "rejected"))?.statusReason).toBe("gate ok recusado");
  });

  test("só responde gate aberto, na tentativa certa e uma vez", async () => {
    const { board, respond, runWhen, gate } = await atGate();
    expect(failure(() => respond("approve", undefined, "plan"))).toBe(
      "invalid_state: gate plan (attempt 1) is not open",
    );
    expect(failure(() => respond("approve", undefined, "approve", 2))).toBe(
      "invalid_state: gate approve (attempt 2) is not open",
    );
    expect(failure(() => board.workflows.respond("nada", "approve", 1, "approve"))).toBe(
      "not_found: run nada does not exist",
    );
    respond("approve");
    expect(failure(() => respond("reject"))).toBe(
      "invalid_state: gate approve (attempt 1) is not open",
    );
    expect((await runWhen((r) => r.status === "completed"))?.steps[1]?.note).toBeNull();
    expect(gate?.id).toBeDefined();
  });

  test("gate aberto libera a vaga; aprovado com o host cheio, espera a vaga", async () => {
    const { board, project, respond, runWhen, allow } = await atGate(YAML, {
      board: { maxParallelRuns: 1 },
    });
    const other = board.createCard(project.id, { title: "Outro", description: "[tool] x" });
    await board.startCard(other.id);
    const holding = await cardWhen(
      board,
      other.id,
      (c) => c.sessionStatus === "awaiting_permission",
    );
    expect(holding?.queued).toBe(false);
    respond("approve");
    await Bun.sleep(100);
    expect((await runWhen(() => true))?.steps.map((s) => s.stepId)).toEqual(["plan", "approve"]);
    allow(holding?.sessionId);
    expect(await runWhen((r) => r.status === "completed")).not.toBeNull();
  });

  test("com o gate aberto, iniciar o card de novo é recusado", async () => {
    const { board, card } = await atGate();
    const again = await board.startCard(card.id).then(
      () => null,
      (error: { message?: string }) => error.message,
    );
    expect(again).toBe("o card tem uma execução de workflow em andamento");
  });
});
