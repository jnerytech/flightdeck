import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Config, loadConfig } from "../src/config.ts";
import { cardWhen, newBoard } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

async function setup(maxParallelRuns?: number, setupScript?: string) {
  const ctx = newBoard(maxParallelRuns ? { maxParallelRuns } : {});
  boards.push(ctx.board);
  const project = await ctx.board.addProject({
    path: ctx.repo,
    promptTemplate: "",
    ...(setupScript ? { setupScript } : {}),
  });
  /** `[tool]` keeps the session waiting for a permission: the run holds its slot until answered. */
  const card = (title: string, description = "[tool]") =>
    ctx.board.createCard(project.id, { title, description });
  const allow = (sessionId: string | null) => {
    const request = ctx.store.pendingPermissions(sessionId ?? "")[0];
    ctx.manager.respondPermission({ requestId: request?.id ?? "", decision: "allow" });
  };
  return { ...ctx, project, card, allow };
}

const holding = (status: string | null) => status === "awaiting_permission";

describe("fila", () => {
  test("maxParallelRuns na config: padrão 2, mínimo 1", () => {
    const file = join(tempDir(), "config.json");
    writeFileSync(file, JSON.stringify({ token: "t".repeat(32) }));
    expect(loadConfig(file).maxParallelRuns).toBe(2);
    writeFileSync(file, JSON.stringify({ token: "t".repeat(32), maxParallelRuns: 1 }));
    expect(loadConfig(file).maxParallelRuns).toBe(1);
    expect(Config.safeParse({ maxParallelRuns: 0 }).success).toBe(false);
  });

  test("com maxParallelRuns: 1, o segundo card espera e sobe quando o primeiro fica idle", async () => {
    const { board, card, allow } = await setup(1);
    const a = card("Primeiro");
    const b = card("Segundo");
    await board.startCard(a.id);
    const first = await cardWhen(board, a.id, (c) => holding(c.sessionStatus));
    expect(first).not.toBeNull();
    const queued = await board.startCard(b.id);
    expect(queued).toMatchObject({ column: "in_progress", queued: true, sessionId: null });
    await Bun.sleep(100);
    expect(board.getCard(b.id)).toMatchObject({ queued: true, sessionId: null });
    allow(first?.sessionId ?? null);
    expect(await cardWhen(board, a.id, (c) => c.sessionStatus === "idle")).not.toBeNull();
    const second = await cardWhen(board, b.id, (c) => c.sessionId !== null);
    expect(second?.queued).toBe(false);
    expect(second?.runs[0]?.startedAt).not.toBeNull();
  });

  test("a fila respeita a ordem de início", async () => {
    const { board, card, allow } = await setup(1);
    const a = card("A");
    const c = card("C");
    const b = card("B");
    await board.startCard(a.id);
    const first = await cardWhen(board, a.id, (x) => holding(x.sessionStatus));
    expect(first).not.toBeNull();
    await board.startCard(b.id);
    await board.startCard(c.id);
    allow(first?.sessionId ?? null);
    const second = await cardWhen(board, b.id, (x) => holding(x.sessionStatus));
    expect(second).not.toBeNull();
    expect(board.getCard(c.id).queued).toBe(true);
    allow(second?.sessionId ?? null);
    expect(await cardWhen(board, c.id, (x) => x.sessionId !== null)).not.toBeNull();
  });

  test("Parar um card em execução libera a vaga; Parar um card na fila tira ele da fila", async () => {
    const { board, card } = await setup(1);
    const a = card("Rodando");
    const b = card("Na fila");
    const c = card("Depois");
    await board.startCard(a.id);
    expect(await cardWhen(board, a.id, (x) => holding(x.sessionStatus))).not.toBeNull();
    await board.startCard(b.id);
    await board.startCard(c.id);
    const left = await board.stopCard(b.id);
    expect(left).toMatchObject({ queued: false, column: "backlog", sessionId: null });
    expect(left.runs[0]?.endedAt).not.toBeNull();
    await board.stopCard(a.id);
    expect(await cardWhen(board, c.id, (x) => x.sessionId !== null)).not.toBeNull();
    expect(board.getCard(b.id)).toMatchObject({ queued: false, sessionId: null });
  });

  test("falha na preparação libera a vaga", async () => {
    const { board, card } = await setup(1, "exit 4");
    const a = card("Falha");
    const b = card("Seguinte");
    await board.startCard(a.id);
    await board.startCard(b.id);
    expect(await cardWhen(board, a.id, (x) => x.notice !== null)).not.toBeNull();
    expect(await cardWhen(board, b.id, (x) => x.notice !== null)).not.toBeNull();
    expect(board.getCard(b.id).queued).toBe(false);
  });

  test("padrão de 2 em paralelo; aumentar o limite sobe quem está na fila", async () => {
    const { board, card } = await setup();
    const [a, b, c] = [card("A"), card("B"), card("C")];
    for (const x of [a, b, c]) await board.startCard(x.id);
    expect(await cardWhen(board, a.id, (x) => holding(x.sessionStatus))).not.toBeNull();
    expect(await cardWhen(board, b.id, (x) => holding(x.sessionStatus))).not.toBeNull();
    expect(board.getCard(c.id).queued).toBe(true);
    expect(board.maxParallelRuns).toBe(2);
    board.setMaxParallelRuns(3);
    expect(board.maxParallelRuns).toBe(3);
    expect(await cardWhen(board, c.id, (x) => x.sessionId !== null)).not.toBeNull();
  });

  test("sessões fora de cards não contam no limite", async () => {
    const { board, card, manager, root } = await setup(1);
    const loose = manager.create({ cwd: root, prompt: "[tool]" });
    const a = card("Card");
    await board.startCard(a.id);
    expect(await cardWhen(board, a.id, (x) => x.sessionId !== null)).not.toBeNull();
    expect(manager.get(loose.sessionId).status).not.toBe("ended");
  });

  test("iniciar um card que já está rodando ou na fila é recusado", async () => {
    const { board, card } = await setup(1);
    const a = card("A");
    const b = card("B");
    await board.startCard(a.id);
    await board.startCard(b.id);
    const codes: string[] = [];
    for (const id of [a.id, b.id]) {
      codes.push(
        await board.startCard(id).then(
          () => "aceitou",
          (e: { code: string }) => e.code,
        ),
      );
    }
    expect(codes).toEqual(["invalid_state", "invalid_state"]);
  });
});
