import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { OUTPUTS_SEPARATOR } from "../src/workflows/interpolate.ts";
import { poll } from "./helpers.ts";
import { workflowCard } from "./workflow-helpers.ts";

// Real git in temp repositories and several turns per test: more than the default 5 s.
setDefaultTimeout(30_000);

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

async function setup(yaml: string, maxParallelRuns: number) {
  const ctx = await workflowCard(yaml, { board: { maxParallelRuns } });
  boards.push(ctx.board);
  await ctx.start();
  /** Sessions of the parallel items waiting for a permission right now. */
  const asking = () =>
    (ctx.run()?.steps ?? []).filter(
      (s) =>
        s.stepId.startsWith("review.") &&
        ctx.store.pendingPermissions(s.sessionId ?? "").length > 0,
    );
  return { ...ctx, asking };
}

const REVIEW = `steps:
  - id: review
    parallel:
      - agent: { prompt: "[tool] segurança" }
      - agent: { prompt: "[tool] legibilidade" }
  - id: apply
    agent: { prompt: "{{steps.review.outputs}}" }
`;

const reply = (text: string) => `Vou criar um arquivo.\n\nEcho: ${text}`;

describe("engine-parallel", () => {
  test("com vagas livres, os itens rodam ao mesmo tempo e as saídas chegam na ordem declarada", async () => {
    const { asking, allow, runWhen } = await setup(REVIEW, 3);
    const both = await poll(() => (asking().length === 2 ? asking() : null), 5000);
    expect(both?.map((s) => s.stepId).sort()).toEqual(["review.0", "review.1"]);
    // Answered in reverse: the outputs still follow the declared order.
    allow(both?.find((s) => s.stepId === "review.1")?.sessionId);
    await Bun.sleep(50);
    allow(both?.find((s) => s.stepId === "review.0")?.sessionId);
    const run = await runWhen((r) => r.status === "completed", 10_000);
    const outputs = [reply("[tool] segurança"), reply("[tool] legibilidade")];
    expect(run?.steps.find((s) => s.stepId === "review")).toMatchObject({
      type: "parallel",
      status: "completed",
      output: outputs.join(OUTPUTS_SEPARATOR),
    });
    expect(run?.steps.find((s) => s.stepId === "apply")?.output).toBe(
      `Echo: ${outputs.join(OUTPUTS_SEPARATOR)}`,
    );
  });

  test("com o host cheio, os itens esperam a vaga do card, um depois do outro", async () => {
    const { asking, allow, run, runWhen } = await setup(REVIEW, 1);
    const first = await poll(() => (asking().length === 1 ? asking() : null), 5000);
    expect(first?.map((s) => s.stepId)).toEqual(["review.0"]);
    await Bun.sleep(100);
    expect(run()?.steps.map((s) => s.stepId)).toEqual(["review", "review.0"]);
    allow(first?.[0]?.sessionId);
    const second = await poll(() => asking().find((s) => s.stepId === "review.1") ?? null, 5000);
    expect(second?.stepId).toBe("review.1");
    allow(second?.sessionId);
    const done = await runWhen((r) => r.status === "completed", 10_000);
    expect(done?.steps.find((s) => s.stepId === "apply")?.output).toBe(
      `Echo: ${[reply("[tool] segurança"), reply("[tool] legibilidade")].join(OUTPUTS_SEPARATOR)}`,
    );
  });

  test("as vagas extras voltam para a fila do host no fim do paralelo", async () => {
    const yaml =
      "steps:\n  - id: review\n    parallel: [{ agent: { prompt: a } }, { agent: { prompt: b } }]\n";
    const { board, project, runWhen } = await setup(yaml, 2);
    expect(await runWhen((r) => r.status === "completed", 10_000)).not.toBeNull();
    const others = ["Um", "Dois"].map((title) =>
      board.createCard(project.id, { title, description: "[tool] x" }),
    );
    for (const card of others) await board.startCard(card.id);
    const started = await poll(
      () => (others.every((c) => board.getCard(c.id).sessionId !== null) ? true : null),
      5000,
    );
    expect(started).toBe(true);
  });

  test("item que falha encerra a execução depois dos outros terminarem", async () => {
    const yaml = [
      "steps:",
      "  - id: review",
      "    parallel: [{ agent: { prompt: ok } }, { agent: { prompt: '[fail]' } }]",
    ].join("\n");
    const { runWhen } = await setup(yaml, 3);
    const run = await runWhen((r) => r.status === "failed", 10_000);
    expect(run?.statusReason).toBe("etapa review.1 falhou: falha simulada do runtime");
    expect(run?.steps.map((s) => `${s.stepId} ${s.status}`).sort()).toEqual([
      "review failed",
      "review.0 completed",
      "review.1 failed",
    ]);
  });
});
