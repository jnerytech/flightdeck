import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  installCheckGuard,
  installFakeCheck,
  refusedChecks,
} from "../../../scripts/test/check-guard.ts";
import type { FakeCli } from "../../../scripts/test/fake-cli.ts";
import type { CheckRunner } from "../src/workflows/check-runner.ts";
import { shellCheckRunner } from "../src/workflows/check-runner.ts";
import { cardWhen } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";
import { workflowCard } from "./workflow-helpers.ts";

// Real git, and every fake check is a Bun process: more than the default 5 s.
setDefaultTimeout(20_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

async function setup(yaml: string, options: Parameters<typeof workflowCard>[1] = {}) {
  const ctx = await workflowCard(yaml, options);
  cleanups.push(() => ctx.board.stop());
  return ctx;
}

function fakeCheck(rules: Parameters<typeof installFakeCheck>[1]): FakeCli {
  const fake = installFakeCheck("fd-check", rules);
  cleanups.push(() => fake.restore());
  return fake;
}

/** Records what reaches it and passes; stands for "the executor" in the trust tests. */
function recordingRunner() {
  const calls: Array<{ command: string; cwd: string }> = [];
  const runner: CheckRunner = {
    run: async (command, cwd) => {
      calls.push({ command, cwd });
      return { exitCode: 0, output: "ok" };
    },
  };
  return { calls, runner };
}

const LINT = "steps:\n  - id: lint\n    check: fd-check lint\n";

describe("engine-check", () => {
  test("check grava o código de retorno e a saída", async () => {
    const fake = fakeCheck([{ args: ["lint"], stdout: "tudo certo\n" }]);
    const { start, runWhen } = await setup(LINT);
    await start();
    const run = await runWhen((r) => r.status === "completed");
    expect(run?.steps).toMatchObject([
      {
        stepId: "lint",
        attempt: 1,
        type: "check",
        status: "completed",
        exitCode: 0,
        output: "tudo certo\n",
      },
    ]);
    expect(fake.calls()).toEqual([["lint"]]);
  });

  test("check que falha grava o código e encerra a execução; o card espera você", async () => {
    fakeCheck([{ args: ["lint"], stdout: "2 erros", code: 3 }]);
    const yaml = `${LINT}  - id: depois\n    agent: { prompt: x }\n`;
    const { board, card, start, runWhen } = await setup(yaml);
    await start();
    const run = await runWhen((r) => r.status === "failed");
    expect(run?.statusReason).toBe("etapa lint falhou: check saiu com código 3");
    expect(run?.steps).toMatchObject([
      { stepId: "lint", status: "failed", exitCode: 3, output: "2 erros" },
    ]);
    const waiting = await cardWhen(board, card.id, (c) => c.column === "waiting");
    expect(waiting?.column).toBe("waiting");
  });

  test("a saída guarda só os últimos 8 KB", async () => {
    fakeCheck([{ args: ["lint"], stdout: `${"x".repeat(9000)}FIM` }]);
    const { start, runWhen } = await setup(LINT);
    await start();
    const output = (await runWhen((r) => r.status === "completed"))?.steps[0]?.output ?? "";
    expect(output).toHaveLength(8192);
    expect(output.endsWith("xFIM")).toBe(true);
  });

  test("o executor recebe o comando literal e a worktree do card", async () => {
    const { calls, runner } = recordingRunner();
    const { board, card, start, runWhen } = await setup(LINT, { board: { checks: runner } });
    await start();
    expect((await runWhen((r) => r.status === "completed"))?.steps[0]?.output).toBe("ok");
    expect(calls).toEqual([
      { command: "fd-check lint", cwd: board.getCard(card.id).worktreePath ?? "?" },
    ]);
  });

  test("comando fora do workflow confiado nunca chega ao executor", async () => {
    const yaml =
      "steps:\n  - id: a\n    agent: { prompt: '[tool] a' }\n  - id: lint\n    check: lint\n";
    for (const tamper of [
      "DELETE FROM trusted_workflows",
      "UPDATE workflow_runs SET definition = replace(definition, 'check: lint', 'check: curl evil')",
    ]) {
      const { calls, runner } = recordingRunner();
      const { store, start, runWhen, allow } = await setup(yaml, { board: { checks: runner } });
      await start();
      const asking = await runWhen(
        (r) => store.pendingPermissions(r.steps[0]?.sessionId ?? "").length > 0,
      );
      store.db.query(tamper).run();
      allow(asking?.steps[0]?.sessionId);
      const run = await runWhen((r) => r.status === "failed");
      expect(run?.statusReason).toBe("etapa lint falhou: comando fora do workflow confiado: lint");
      expect(calls).toEqual([]);
    }
  });

  test("executor real: sob a trava, o que não é comando falso é recusado antes do shell", async () => {
    const env: Record<string, string | undefined> = { ...process.env };
    const other = installCheckGuard(env);
    const dir = tempDir();
    const refused = await shellCheckRunner(env).run("git status", dir);
    expect(refused).toEqual({
      exitCode: 99,
      output: "trava de check: comando recusado (não é um comando falso do teste): git status",
    });
    expect(refusedChecks(other)).toEqual(["git status"]);
    expect(readFileSync(join(other.dir, "allowed"), "utf8")).toBe("");
    // Under the preload's guard, a fake installed by the test goes through the shell.
    fakeCheck([{ args: ["oi"], stdout: "saída", code: 4 }]);
    expect(await shellCheckRunner().run("fd-check oi", dir)).toEqual({
      exitCode: 4,
      output: "saída",
    });
  });
});
