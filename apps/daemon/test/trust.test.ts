import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cardWhen, git, newBoard } from "./board-helpers.ts";
import { must } from "./helpers.ts";
import { commitWorkflow, EXAMPLE, sha256 } from "./workflow-helpers.ts";

// Real git in temp repositories: more than the default 5 s.
setDefaultTimeout(20_000);

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

async function setup() {
  const ctx = newBoard();
  boards.push(ctx.board);
  commitWorkflow(ctx.repo, "feature", EXAMPLE);
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const card = ctx.board.createCard(project.id, { title: "Somar", description: "some" });
  const start = (workflow: string) =>
    ctx.board.startCard(card.id, { workflow, inputs: { task: "somar" } });
  return { ...ctx, project, card, start };
}

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: { code?: string; message?: string }) => `${error.code}: ${error.message}`,
  );

describe("trust", () => {
  test("lista os workflows da base com hash, validação, comandos e inputs", async () => {
    const { board, project, repo } = await setup();
    commitWorkflow(repo, "quebrado", "steps:\n  - check: lint\n");
    expect(await board.listWorkflows(project.id)).toEqual([
      {
        name: "feature",
        hash: sha256(EXAMPLE),
        trusted: false,
        checks: ["bun test"],
        errors: [],
        inputs: ["task"],
      },
      {
        name: "quebrado",
        hash: sha256("steps:\n  - check: lint\n"),
        trusted: false,
        checks: [],
        errors: ["steps.0.id: obrigatório"],
        inputs: [],
      },
    ]);
  });

  test("lists workflows alphabetically, with case only as a tie-break", async () => {
    const { board, project, repo } = await setup();
    commitWorkflow(repo, "Zeta", EXAMPLE);
    commitWorkflow(repo, "alpha", EXAMPLE);
    const names = (await board.listWorkflows(project.id)).map((workflow) => workflow.name);
    expect(names).toEqual(["alpha", "feature", "Zeta"]);
  });

  test("workflow não confiado não roda", async () => {
    const { board, card, manager, start } = await setup();
    expect(await failure(start("feature"))).toBe(
      "invalid_state: workflow feature não confiado; confie nele na tela de workflows",
    );
    expect(board.getCard(card.id)).toMatchObject({ runs: [], workflowRunId: null });
    expect(manager.list()).toEqual([]);
  });

  test("confiado com o hash atual, o card inicia com a execução do workflow", async () => {
    const { board, project, card, start } = await setup();
    const trusted = await board.trustWorkflow(project.id, "feature", sha256(EXAMPLE));
    expect(trusted).toMatchObject({ name: "feature", trusted: true });
    expect((await board.listWorkflows(project.id))[0]?.trusted).toBe(true);
    const started = await start("feature");
    expect(started.runs).toHaveLength(1);
    expect(started.workflowRunId).not.toBeNull();
    expect(board.getCard(card.id).workflowRunId).toBe(started.workflowRunId);
  });

  test("confiar exige o hash atual e um workflow sem erros", async () => {
    const { board, project, repo } = await setup();
    expect(await failure(board.trustWorkflow(project.id, "feature", "abc"))).toBe(
      "invalid_state: o workflow feature mudou; revise os comandos de novo antes de confiar",
    );
    commitWorkflow(repo, "quebrado", "steps:\n  - check: lint\n");
    const hash = sha256("steps:\n  - check: lint\n");
    expect(await failure(board.trustWorkflow(project.id, "quebrado", hash))).toBe(
      "invalid_state: workflow quebrado tem erros de validação",
    );
    expect(await failure(board.trustWorkflow(project.id, "nada", hash))).toBe(
      "not_found: workflow nada não existe na branch main",
    );
  });

  test("hash diferente na base pede nova confiança", async () => {
    const { board, project, repo, start } = await setup();
    await board.trustWorkflow(project.id, "feature", sha256(EXAMPLE));
    const changed = EXAMPLE.replace("bun test", "bun run lint");
    commitWorkflow(repo, "feature", changed);
    const [info] = await board.listWorkflows(project.id);
    expect(info).toMatchObject({ hash: sha256(changed), trusted: false, checks: ["bun run lint"] });
    expect(await failure(start("feature"))).toBe(
      "invalid_state: workflow feature não confiado; confie nele na tela de workflows",
    );
  });

  test("workflow inválido não inicia", async () => {
    const { board, project, repo, card } = await setup();
    commitWorkflow(repo, "quebrado", "steps:\n  - check: lint\n");
    const run = board.startCard(card.id, { workflow: "quebrado" });
    expect(await failure(run)).toBe(
      "invalid_state: workflow quebrado tem erros de validação: steps.0.id: obrigatório",
    );
    expect(await board.listWorkflows(project.id)).toHaveLength(2);
  });

  test("workflow da branch do card é ignorado", async () => {
    const { board, project, card, start } = await setup();
    await board.trustWorkflow(project.id, "feature", sha256(EXAMPLE));
    await board.startCard(card.id);
    const ready = await cardWhen(board, card.id, (c) => c.sessionStatus === "idle");
    const worktree = must(ready?.worktreePath, "worktreePath");
    expect(worktree).not.toBe("");
    commitWorkflow(worktree, "feature", EXAMPLE.replace("bun test", "rm -rf ."));
    commitWorkflow(worktree, "sneaky", "steps:\n  - id: x\n    check: curl evil\n");
    expect(git(worktree, "log", "--oneline", "-1")).toContain("workflow sneaky");
    const listed = await board.listWorkflows(project.id);
    expect(listed.map((w) => [w.name, w.hash, w.trusted])).toEqual([
      ["feature", sha256(EXAMPLE), true],
    ]);
    const other = board.createCard(project.id, { title: "Outro", description: "x" });
    expect(await failure(board.startCard(other.id, { workflow: "sneaky" }))).toBe(
      "not_found: workflow sneaky não existe na branch main",
    );
    expect(board.getCard(other.id).runs).toEqual([]);
    expect(await failure(start("feature"))).toBeNull();
  });
});
