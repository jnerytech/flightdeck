import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { installFakeCheck } from "../../../scripts/test/check-guard.ts";
import type { FakeRule } from "../../../scripts/test/fake-cli.ts";
import { cardWhen } from "./board-helpers.ts";
import { workflowCard } from "./workflow-helpers.ts";

// Real git, and every fake check is a Bun process: more than the default 5 s.
setDefaultTimeout(30_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

async function run(yaml: string, rules: FakeRule[]) {
  const fake = installFakeCheck("fd-check", rules);
  cleanups.push(() => fake.restore());
  const ctx = await workflowCard(yaml);
  cleanups.push(() => ctx.board.stop());
  await ctx.start();
  return { ...ctx, fake };
}

const LOOP = `steps:
  - id: implement
    agent: { prompt: implemente }
  - id: tests
    loop:
      max: 2
      until: { check: fd-check test }
      do:
        agent: { continue: implement, prompt: "falhou ({{loop.lastCheck.exitCode}}): {{loop.lastCheck.output}}" }
  - id: done
    agent: { prompt: "testes: {{steps.tests.output}}" }
`;

const steps = (r: { steps: Array<{ stepId: string; attempt: number; status: string }> } | null) =>
  r?.steps.map((s) => `${s.stepId}#${s.attempt} ${s.status}`);

describe("engine-loop", () => {
  test("repete o do até o check passar, com o último check no prompt", async () => {
    const { runWhen } = await run(LOOP, [
      { args: ["test"], call: 1, stdout: "1 fail", code: 1 },
      { args: ["test"], stdout: "tudo passa" },
    ]);
    const done = await runWhen((r) => r.status === "completed", 10_000);
    expect(steps(done)).toEqual([
      "implement#1 completed",
      "tests#1 completed",
      "tests.check#1 failed",
      "tests.do#1 completed",
      "tests.check#2 completed",
      "done#1 completed",
    ]);
    const byId = (id: string, attempt = 1) =>
      done?.steps.find((s) => s.stepId === id && s.attempt === attempt);
    expect(byId("tests.check")).toMatchObject({ type: "check", exitCode: 1, output: "1 fail" });
    expect(byId("tests.do")).toMatchObject({ type: "agent", output: "Echo: falhou (1): 1 fail" });
    expect(byId("tests.do")?.sessionId).toBe(byId("implement")?.sessionId ?? "?");
    expect(byId("tests")).toMatchObject({ type: "loop", output: "tudo passa" });
    expect(byId("done")?.output).toBe("Echo: testes: tudo passa");
  });

  test("check que passa de primeira não roda o do", async () => {
    const { runWhen } = await run(LOOP, [{ args: ["test"], stdout: "ok" }]);
    const done = await runWhen((r) => r.status === "completed", 10_000);
    expect(steps(done)).toEqual([
      "implement#1 completed",
      "tests#1 completed",
      "tests.check#1 completed",
      "done#1 completed",
    ]);
  });

  test("estourou max: pausa em Esperando você com o motivo", async () => {
    const { board, card, fake, runWhen } = await run(LOOP, [
      { args: ["test"], stdout: "sempre falha", code: 2 },
    ]);
    const paused = await runWhen((r) => r.status === "paused", 15_000);
    expect(paused?.statusReason).toBe("loop tests: o check ainda falha depois de 2 repetições");
    expect(steps(paused)).toEqual([
      "implement#1 completed",
      "tests#1 failed",
      "tests.check#1 failed",
      "tests.do#1 completed",
      "tests.check#2 failed",
      "tests.do#2 completed",
      "tests.check#3 failed",
    ]);
    expect(paused?.endedAt).not.toBeNull();
    expect(fake.calls()).toHaveLength(3);
    expect((await cardWhen(board, card.id, (c) => c.column === "waiting"))?.column).toBe("waiting");
  });

  test("o do pode ser um check; check do do que falha encerra a execução", async () => {
    const yaml = [
      "steps:",
      "  - id: fix",
      "    loop: { max: 3, until: { check: fd-check test }, do: { check: fd-check fix } }",
    ].join("\n");
    const ok = await run(yaml, [
      { args: ["test"], call: 1, code: 1 },
      { args: ["fix"], stdout: "corrigido" },
      { args: ["test"], stdout: "ok" },
    ]);
    const done = await ok.runWhen((r) => r.status === "completed", 10_000);
    expect(steps(done)).toEqual([
      "fix#1 completed",
      "fix.check#1 failed",
      "fix.do#1 completed",
      "fix.check#2 completed",
    ]);
    const broken = await run(yaml, [
      { args: ["test"], code: 1 },
      { args: ["fix"], code: 5 },
    ]);
    const failed = await broken.runWhen((r) => r.status === "failed", 10_000);
    expect(failed?.statusReason).toBe("etapa fix.do falhou: check saiu com código 5");
  });
});
