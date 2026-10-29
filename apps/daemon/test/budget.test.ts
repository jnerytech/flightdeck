import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { addTurn, noSpending, overBudget } from "../src/workflows/budget.ts";
import { cardWhen } from "./board-helpers.ts";
import { workflowCard } from "./workflow-helpers.ts";

// Real git in temp repositories and several turns per test: more than the default 5 s.
setDefaultTimeout(20_000);

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

async function run(yaml: string, clock?: () => number) {
  const ctx = await workflowCard(yaml, { board: clock ? { clock } : {} });
  boards.push(ctx.board);
  await ctx.start();
  return ctx;
}

/** A clock that moves `stepMinutes` forward every time it is read. */
function ticking(stepMinutes: number) {
  let now = Date.UTC(2026, 9, 1);
  return () => {
    now += stepMinutes * 60_000;
    return now;
  };
}

describe("budget", () => {
  test("turnos somam entre sessões; o estouro pausa a execução em Esperando você", async () => {
    const yaml = [
      "budget: { maxTurns: 2 }",
      "steps:",
      "  - id: a",
      "    agent: { prompt: a }",
      "  - id: b",
      "    agent: { prompt: b }",
      "  - id: c",
      "    agent: { prompt: c }",
    ].join("\n");
    const { board, card, runWhen } = await run(yaml);
    const paused = await runWhen((r) => r.status === "paused");
    expect(paused?.statusReason).toBe("orçamento estourado: 2 de 2 turnos");
    expect(paused?.usage).toEqual({ turns: 2, minutes: expect.any(Number), costUsd: 0 });
    expect(paused?.budget).toEqual({ maxTurns: 2 });
    expect(paused?.steps.map((s) => s.stepId)).toEqual(["a", "b"]);
    expect(new Set(paused?.steps.map((s) => s.sessionId)).size).toBe(2);
    expect((await cardWhen(board, card.id, (c) => c.column === "waiting"))?.column).toBe("waiting");
  });

  test("minutos de relógio (injetado) somam entre sessões", async () => {
    const yaml = [
      "budget: { maxMinutes: 6 }",
      "steps:",
      "  - id: a",
      "    agent: { prompt: a }",
      "  - id: b",
      "    agent: { prompt: b }",
      "  - id: c",
      "    agent: { prompt: c }",
    ].join("\n");
    // Read once when the turn starts and once when it ends: 3 minutes per turn.
    const { runWhen } = await run(yaml, ticking(3));
    const paused = await runWhen((r) => r.status === "paused");
    expect(paused?.usage).toEqual({ turns: 2, minutes: 6, costUsd: 0 });
    expect(paused?.statusReason).toBe("orçamento estourado: 6 de 6 minutos");
    // Each agent step keeps its own share: the timeline shows it.
    expect(paused?.steps.map((s) => s.usage)).toEqual([
      { turns: 1, minutes: 3, costUsd: 0 },
      { turns: 1, minutes: 3, costUsd: 0 },
    ]);
  });

  test("o custo usa o último total de cada sessão, nunca a soma turno a turno", async () => {
    const yaml = [
      "budget: { maxCostUsd: 1.5 }",
      "steps:",
      "  - id: a",
      "    agent: { prompt: '[cost:0.25]' }",
      "  - id: b",
      "    agent: { continue: a, prompt: '[cost:0.5]' }",
      "  - id: c",
      "    agent: { prompt: '[cost:1]' }",
      "  - id: d",
      "    agent: { prompt: d }",
    ].join("\n");
    const { runWhen } = await run(yaml);
    const paused = await runWhen((r) => r.status === "paused");
    // Session of a: 0.25 then 0.75 in total (0.75, not 0.25 + 0.75); session of c: 1.
    expect(paused?.usage.costUsd).toBe(1.75);
    expect(paused?.statusReason).toBe("orçamento estourado: US$ 1.75 de US$ 1.50");
    expect(paused?.steps.map((s) => s.stepId)).toEqual(["a", "b", "c"]);
    // Per step, the difference its turn added to the session's total.
    expect(paused?.steps.map((s) => s.usage?.costUsd)).toEqual([0.25, 0.5, 1]);
  });

  test("sem orçamento, nada pausa", async () => {
    const yaml =
      "steps:\n  - id: a\n    agent: { prompt: '[cost:100]' }\n  - id: b\n    agent: { prompt: b }\n";
    const { runWhen } = await run(yaml);
    const done = await runWhen((r) => r.status === "completed");
    expect(done?.usage).toEqual({ turns: 2, minutes: expect.any(Number), costUsd: 100 });
  });

  test("sessão retomada com resume começa do total anterior: conta só a diferença", () => {
    let spending = noSpending();
    spending = addTurn(spending, { sessionId: "s1", costUsd: 0.5, minutes: 1 });
    spending = addTurn(spending, { sessionId: "s2", costUsd: 0.25, minutes: 2 });
    // s1 resumed: its process reports the previous total plus this turn.
    spending = addTurn(spending, { sessionId: "s1", costUsd: 0.75, minutes: 0.5 });
    // A turn without cost information adds nothing; a smaller total never subtracts.
    spending = addTurn(spending, { sessionId: "s2", minutes: 0 });
    spending = addTurn(spending, { sessionId: "s2", costUsd: 0.1, minutes: 0 });
    expect(spending).toEqual({
      turns: 5,
      minutes: 3.5,
      costUsd: 1,
      sessions: { s1: 0.75, s2: 0.25 },
    });
  });

  test("estouro de cada limite tem o seu motivo", () => {
    const spent = { turns: 3, minutes: 12.25, costUsd: 2, sessions: {} };
    expect(overBudget({}, spent)).toBeNull();
    expect(overBudget({ maxTurns: 4, maxMinutes: 20, maxCostUsd: 3 }, spent)).toBeNull();
    expect(overBudget({ maxTurns: 3 }, spent)).toBe("orçamento estourado: 3 de 3 turnos");
    expect(overBudget({ maxMinutes: 12 }, spent)).toBe("orçamento estourado: 12.3 de 12 minutos");
    expect(overBudget({ maxCostUsd: 2 }, spent)).toBe("orçamento estourado: US$ 2.00 de US$ 2.00");
  });
});
