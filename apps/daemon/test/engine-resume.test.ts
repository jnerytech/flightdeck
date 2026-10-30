import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { CheckResult, CheckRunner } from "../src/workflows/check-runner.ts";
import { record } from "./helpers.ts";
import { durableWorkflowCard } from "./workflow-helpers.ts";

// Real git, a file store and several restarts per test: more than the default 5 s.
setDefaultTimeout(30_000);

const stops: Array<() => void> = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

async function setup(yaml: string, checks?: CheckRunner) {
  const ctx = await durableWorkflowCard(yaml, checks ? { checks } : {});
  stops.push(() => ctx.stop());
  return ctx;
}

/** Answers the check calls in order (the last one repeats); `hang` leaves a call unanswered. */
function scripted(results: Array<CheckResult | "hang">) {
  const calls: string[] = [];
  const runner: CheckRunner = {
    run: (command) => {
      const result = results[Math.min(calls.length, results.length - 1)] as CheckResult | "hang";
      calls.push(command);
      return result === "hang" ? new Promise(() => {}) : Promise.resolve(result);
    },
  };
  return { calls, runner };
}

const RESUMED = "A execução foi interrompida; continue de onde parou.";

const statuses = (
  run: { steps: Array<{ stepId: string; attempt: number; status: string }> } | null,
) => run?.steps.map((s) => `${s.stepId}#${s.attempt} ${s.status}`);

describe("engine-resume", () => {
  test("agent interrompido no meio do turno retoma a sessão e reenvia o prompt com o aviso", async () => {
    const yaml = [
      "steps:",
      "  - id: plan",
      "    agent: { prompt: plano }",
      "  - id: work",
      "    agent: { prompt: '[tool] faça {{steps.plan.output}}' }",
    ].join("\n");
    const { host, restart, asking, allow, runWhen } = await setup(yaml);
    const before = await asking("work");
    const session = before?.steps[1]?.sessionId ?? "";
    await restart();
    const again = await asking("work");
    expect(again?.status).toBe("running");
    expect(again?.steps[1]?.sessionId).toBe(session);
    allow(session);
    const done = await runWhen((r) => r.status === "completed");
    const prompt = "[tool] faça Echo: plano";
    expect(done?.steps[1]?.output).toBe(`Vou criar um arquivo.\n\nEcho: ${RESUMED}\n\n${prompt}`);
    const texts = record(host.manager, session)
      .find("message.user")
      .map((e) => e.text);
    expect(texts).toEqual([prompt, `${RESUMED}\n\n${prompt}`]);
    // plan did not run again.
    expect(host.manager.list()).toHaveLength(2);
    expect(statuses(done)).toEqual(["plan#1 completed", "work#1 completed"]);
  });

  test("check interrompido roda de novo", async () => {
    const { calls, runner } = scripted(["hang", { exitCode: 0, output: "ok" }]);
    const { restart, runWhen } = await setup("steps:\n  - id: lint\n    check: lint\n", runner);
    expect(await runWhen((r) => r.steps[0]?.status === "running")).not.toBeNull();
    await Bun.sleep(50);
    await restart();
    const done = await runWhen((r) => r.status === "completed");
    expect(done?.steps).toMatchObject([
      { stepId: "lint", status: "completed", exitCode: 0, output: "ok" },
    ]);
    expect(calls).toEqual(["lint", "lint"]);
  });

  test("gate continua aberto depois do reinício e responde no daemon novo", async () => {
    const yaml =
      "steps:\n  - id: ok\n    gate: { message: Seguir? }\n  - id: after\n    agent: { prompt: depois }\n";
    const { host, restart, runWhen } = await setup(yaml);
    expect(await runWhen((r) => r.status === "waiting")).not.toBeNull();
    await restart();
    await Bun.sleep(50);
    const open = await runWhen((r) => r.status === "waiting");
    expect(statuses(open)).toEqual(["ok#1 waiting"]);
    host.board.workflows.respond(host.runId, "ok", 1, "approve", "vai");
    const done = await runWhen((r) => r.status === "completed");
    expect(done?.steps[1]?.output).toBe("Echo: depois");
  });

  test("loop, paralelo e etapas já concluídas retomam do ponto certo, sem repetir nada", async () => {
    const yaml = [
      "steps:",
      "  - id: plan",
      "    agent: { prompt: plano }",
      "  - id: ok",
      "    gate: { message: Seguir? }",
      "  - id: tests",
      "    loop:",
      "      max: 2",
      "      until: { check: test }",
      "      do: { agent: { continue: plan, prompt: '[tool] corrija' } }",
      "  - id: review",
      "    parallel: [{ agent: { prompt: r1 } }, { agent: { prompt: '[tool] r2' } }]",
      "  - id: final",
      "    gate: { message: Fim, show: '{{steps.tests.output}} | {{steps.review.outputs}}' }",
    ].join("\n");
    const { calls, runner } = scripted([
      { exitCode: 1, output: "falhou" },
      { exitCode: 0, output: "passou" },
    ]);
    const { host, restart, asking, allow, runWhen } = await setup(yaml, runner);
    await runWhen((r) => r.status === "waiting");
    host.board.workflows.respond(host.runId, "ok", 1, "approve");
    const fixing = await asking("tests.do");
    await restart();
    expect(await asking("tests.do")).not.toBeNull();
    allow(fixing?.steps.find((s) => s.stepId === "tests.do")?.sessionId);
    const reviewing = await asking("review.1");
    await Bun.sleep(50);
    await restart();
    expect(await asking("review.1")).not.toBeNull();
    allow(reviewing?.steps.find((s) => s.stepId === "review.1")?.sessionId);
    const end = await runWhen((r) => r.status === "waiting" && r.steps.at(-1)?.stepId === "final");
    expect(statuses(end)).toEqual([
      "plan#1 completed",
      "ok#1 approved",
      "tests#1 completed",
      "tests.check#1 failed",
      "tests.do#1 completed",
      "tests.check#2 completed",
      "review#1 completed",
      "review.0#1 completed",
      "review.1#1 completed",
      "final#1 waiting",
    ]);
    expect(calls).toEqual(["test", "test"]);
    expect(end?.steps.at(-1)?.output).toBe(
      `passou | Echo: r1\n\n---\n\nVou criar um arquivo.\n\nEcho: ${RESUMED}\n\n[tool] r2`,
    );
    // plan + review.0 + review.1: the loop's do talks to plan's session.
    expect(host.manager.list()).toHaveLength(3);
    // Once more at the last gate: the finished loop and parallel are not run again.
    await restart();
    await Bun.sleep(50);
    host.board.workflows.respond(host.runId, "final", 1, "approve");
    const done = await runWhen((r) => r.status === "completed");
    expect(done?.steps).toHaveLength(10);
    expect(calls).toHaveLength(2);
    expect(host.manager.list()).toHaveLength(3);
  });

  test("o custo de uma sessão retomada com resume conta só a diferença", async () => {
    const yaml = [
      "steps:",
      "  - id: a",
      "    agent: { prompt: '[cost:0.5]' }",
      "  - id: b",
      "    agent: { continue: a, prompt: '[tool] [cost:0.25]' }",
    ].join("\n");
    const { host, restart, asking, allow, runWhen } = await setup(yaml);
    const waiting = await asking("b");
    await restart();
    expect(await asking("b")).not.toBeNull();
    allow(waiting?.steps[1]?.sessionId);
    const done = await runWhen((r) => r.status === "completed");
    // a: 0.5; b (resumed, its prompt sent again): the session's total goes to 0.75.
    expect(done?.usage.costUsd).toBe(0.75);
    expect(done?.usage.turns).toBe(2);
    expect(host.runtime.starts.filter((s) => s.resume)).toHaveLength(1);
  });
});
