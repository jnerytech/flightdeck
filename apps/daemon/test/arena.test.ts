import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Arena, Card } from "@flightdeck/protocol";
import type { BoardOptions } from "../src/board/board.ts";
import { ClaudeSdkRuntime, type QueryHandle } from "../src/runtime/claude-sdk-runtime.ts";
import { startServer } from "../src/server.ts";
import type { CheckRunner } from "../src/workflows/check-runner.ts";
import { git, whenChanged } from "./board-helpers.ts";
import { record } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { workflowCard } from "./workflow-helpers.ts";

// Real git and worktrees, two or more sessions per test: more than the default 5 s.
setDefaultTimeout(20_000);

const TOKEN = "arena-token-0123456789abcdef0";
const WF =
  "steps:\n  - id: work\n    agent: { prompt: '[commit] faça' }\n  - id: verify\n    check: bun test\n";
const slash = (path: string) => path.replaceAll("\\", "/");

/** Polls an async check until it gives something; `null` on timeout, so the `expect` fails. */
async function until<T>(check: () => Promise<T | null>, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await Bun.sleep(20);
  }
}

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Passes in `arena-a`'s worktree and fails in `arena-b`'s. */
const checks: CheckRunner = {
  run: async (_command, cwd) => ({
    exitCode: slash(cwd).endsWith("/arena-b") ? 1 : 0,
    output: "ok",
  }),
};

async function setup(board: Partial<BoardOptions> = {}) {
  const costs = new Map<string, number>();
  const ctx = await workflowCard(WF, {
    board: { checks, cardCost: (id) => costs.get(id) ?? null, ...board },
  });
  cleanups.push(() => ctx.board.stop());
  const card = ctx.board.createCard(ctx.project.id, {
    title: "Arena",
    description: "[commit] faça",
  });
  const settled = (arena: Arena) =>
    arena.variants.length > 0 &&
    arena.variants.every(
      (v) =>
        !v.queued &&
        v.worktreePath !== null &&
        v.sessionStatus !== null &&
        v.sessionStatus !== "starting" &&
        v.sessionStatus !== "running",
    );
  /** Waits, on the arena card's own changes, until every variant has finished its work. */
  const finished = () =>
    whenChanged(ctx.board, async () => {
      const arena = await ctx.board.arena(card.id);
      return settled(arena) ? arena : null;
    });
  const visible = () =>
    ctx.board.getBoard(ctx.project.id).columns.flatMap((c) => c.cards.map((x) => x.title));
  return { ...ctx, arenaCard: card, costs, finished, visible };
}

const code = async (fn: () => unknown) => {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).message;
  }
};

describe("arena", () => {
  test("2 a 4 variantes: cada uma com a sua worktree e a sua branch fd/<slug>-a, -b…, fora do board, e o card em andamento", async () => {
    const { board, arenaCard, finished, visible } = await setup();
    const arena = await board.startArena(arenaCard.id, { variants: [{}, {}, {}] });
    expect(arena.variants.map((v) => v.label)).toEqual(["a", "b", "c"]);
    const done = await finished();
    expect(done?.variants.map((v) => v.branch)).toEqual(["fd/arena-a", "fd/arena-b", "fd/arena-c"]);
    const paths = done?.variants.map((v) => v.worktreePath ?? "") ?? [];
    expect(new Set(paths).size).toBe(3);
    expect(paths.every((p) => existsSync(p))).toBe(true);
    // The variants are cards of their own, hidden: the board has the arena's card and the other.
    expect(visible().sort()).toEqual(["Arena", "Somar"]);
    expect(board.getCard(arenaCard.id)).toMatchObject({ arenaVariants: 3, column: "in_progress" });
    expect(board.getCard(done?.variants[0]?.id ?? "")).toMatchObject({
      arenaOf: arenaCard.id,
      variant: { label: "a", model: null, effort: null },
    });
  });

  test("todas recebem o mesmo pedido; modelo e esforço de cada variante chegam ao runtime", async () => {
    const { board, arenaCard, finished, runtime, manager } = await setup();
    await board.startArena(arenaCard.id, {
      variants: [
        { model: "claude-sonnet-5-5", effort: "low" },
        { model: "claude-opus-5-5", effort: "max" },
      ],
    });
    const done = await finished();
    const start = (label: string) =>
      runtime.starts.find((s) => slash(s.cwd).endsWith(`/arena-${label}`));
    expect(start("a")).toMatchObject({ model: "claude-sonnet-5-5", effort: "low" });
    expect(start("b")).toMatchObject({ model: "claude-opus-5-5", effort: "max" });
    const prompts = (done?.variants ?? []).map((v) => {
      const events = record(manager, board.getCard(v.id).sessionId ?? "");
      const texts = events.find("message.user").map((e) => e.text);
      events.unsubscribe();
      return texts[0];
    });
    expect(prompts[0]).toContain("[commit] faça");
    expect(prompts[1]).toBe(prompts[0]);
  });

  test("o SDK recebe o esforço da sessão", () => {
    const seen: Options[] = [];
    const runtime = new ClaudeSdkRuntime({
      query: ({ options }) => {
        seen.push(options);
        return {
          async *[Symbol.asyncIterator](): AsyncGenerator<SDKMessage> {},
          interrupt: async () => {},
          close: () => {},
        } as QueryHandle;
      },
    });
    const base = {
      cwd: ".",
      permissionMode: "default" as const,
      env: {},
      canUseTool: async () => ({ behavior: "allow" as const }),
    };
    void runtime.start({ ...base, effort: "high" }).close();
    void runtime.start(base).close();
    expect(seen[0]).toMatchObject({ effort: "high" });
    expect(seen[1]?.effort).toBeUndefined();
  });

  test("as recusas: menos de 2 ou mais de 4 variantes, esforço inválido, card que já tem arena, worktree ou não existe", async () => {
    const { board, arenaCard } = await setup();
    expect(await code(() => board.startArena(arenaCard.id, { variants: [{}] }))).toBe(
      "bad_request",
    );
    expect(
      await code(() => board.startArena(arenaCard.id, { variants: [{}, {}, {}, {}, {}] })),
    ).toBe("bad_request");
    expect(await code(() => board.startArena("nao-existe", { variants: [{}, {}] }))).toBe(
      "not_found",
    );
    await board.startArena(arenaCard.id, { variants: [{}, {}] });
    expect(await code(() => board.startArena(arenaCard.id, { variants: [{}, {}] }))).toBe(
      "invalid_state",
    );
    const started = board.createCard(arenaCard.projectId, {
      title: "Já iniciado",
      description: "x",
    });
    await board.startCard(started.id);
    expect(await code(() => board.startArena(started.id, { variants: [{}, {}] }))).toBe(
      "invalid_state",
    );
  });

  test("com workflow: cada variante roda o seu; a comparação traz diff, checks, custo e duração", async () => {
    const { board, arenaCard, costs } = await setup();
    const arena = await board.startArena(arenaCard.id, { variants: [{}, {}], workflow: "wf" });
    costs.set(arena.variants[0]?.id ?? "", 0.5);
    costs.set(arena.variants[1]?.id ?? "", 1.25);
    // On the arena card's own changes: the checks of both variants have ended, with their diff.
    const done = await whenChanged(board, async () => {
      const current = await board.arena(arenaCard.id);
      return current.variants.every(
        (v) =>
          v.checks.length > 0 &&
          v.checks.every((c) => c.status !== "running") &&
          v.files.length > 0,
      )
        ? current
        : null;
    });
    const [a, b] = done?.variants ?? [];
    expect(board.getCard(a?.id ?? "").workflowRunId).not.toBeNull();
    expect(board.getCard(b?.id ?? "").workflowRunId).not.toBe(
      board.getCard(a?.id ?? "").workflowRunId,
    );
    expect(a?.checks).toEqual([{ stepId: "verify", status: "completed" }]);
    expect(b?.checks).toEqual([{ stepId: "verify", status: "failed" }]);
    expect(a?.files).toEqual([{ path: "fake-1.txt", additions: 1, deletions: 0 }]);
    expect(b?.files).toEqual([{ path: "fake-1.txt", additions: 1, deletions: 0 }]);
    expect([a?.costUsd, b?.costUsd]).toEqual([0.5, 1.25]);
    expect(a?.startedAt).not.toBeNull();
    expect(a?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("uma vaga por variante: sem vagas para todas, a que sobra espera na fila e depois roda", async () => {
    const { board, arenaCard, finished } = await setup({ maxParallelRuns: 1 });
    const arena = await board.startArena(arenaCard.id, { variants: [{}, {}] });
    expect(arena.variants.map((v) => v.queued)).toEqual([false, true]);
    const done = await finished();
    expect(done?.variants.map((v) => v.queued)).toEqual([false, false]);
    expect(done?.variants.every((v) => v.worktreePath !== null)).toBe(true);
  });

  test("escolher: pede confirm, só de uma variante parada deste card; a escolhida vira a worktree do card e as outras saem", async () => {
    const { board, arenaCard, finished, project, repo } = await setup();
    const arena = await board.startArena(arenaCard.id, { variants: [{}, {}] });
    const [a, b] = arena.variants;
    // Right after the start both are still running or waiting.
    expect(await code(() => board.chooseVariant(arenaCard.id, b?.id ?? "", true))).toBe(
      "invalid_state",
    );
    const done = await finished();
    const [doneA, doneB] = done?.variants ?? [];
    expect(await code(() => board.chooseVariant(arenaCard.id, doneB?.id ?? "", false))).toBe(
      "invalid_state",
    );
    expect(await code(() => board.chooseVariant(arenaCard.id, "nao-existe", true))).toBe(
      "not_found",
    );
    const other = board.createCard(project.id, { title: "Outro", description: "x" });
    expect(await code(() => board.chooseVariant(other.id, doneB?.id ?? "", true))).toBe(
      "not_found",
    );

    const chosen = await board.chooseVariant(arenaCard.id, doneB?.id ?? "", true);
    expect(chosen).toMatchObject({
      id: arenaCard.id,
      worktreePath: doneB?.worktreePath,
      branch: "fd/arena-b",
      arenaVariants: 0,
      column: "review",
    });
    expect(chosen.sessionId).not.toBeNull();
    expect(existsSync(doneB?.worktreePath ?? "")).toBe(true);
    expect(existsSync(doneA?.worktreePath ?? "?")).toBe(false);
    expect(git(repo, "branch", "--list", "fd/arena-*").replace(/[*+ ]/g, "")).toBe("fd/arena-b");
    expect(await code(() => board.getCard(a?.id ?? ""))).toBe("not_found");
    expect(await code(() => board.getCard(b?.id ?? ""))).toBe("not_found");
    expect((await board.arena(arenaCard.id)).variants).toEqual([]);
    expect((await board.diff(arenaCard.id)).files.map((f) => f.path)).toEqual(["fake-1.txt"]);
    // From here it is a card like any other.
    const again = board.getCard(arenaCard.id) as Card;
    expect(again.runs.length).toBeGreaterThan(0);
  });

  test("uma arena que não consegue começar não deixa nada: as variantes já criadas saem e o card fica como estava", async () => {
    const { board, arenaCard, repo } = await setup();
    const code = await board
      .startArena(arenaCard.id, { variants: [{}, {}], workflow: "nao-existe" })
      .then(
        () => "ok",
        (error: { code?: string }) => error.code,
      );
    // The workflow is not on the base branch: the first variant cannot start.
    expect(code).toBe("not_found");
    expect(board.getCard(arenaCard.id)).toMatchObject({ arenaVariants: 0, column: "backlog" });
    expect(git(repo, "branch", "--list", "fd/arena-*")).toBe("");
  });

  test("descartar o card da arena leva as variantes: worktrees e branches saem", async () => {
    const { board, arenaCard, finished, repo } = await setup();
    await board.startArena(arenaCard.id, { variants: [{}, {}] });
    const done = await finished();
    const paths = (done?.variants ?? []).map((v) => v.worktreePath ?? "");
    expect(paths.every((p) => existsSync(p))).toBe(true);
    await board.discardCard(arenaCard.id, true);
    expect(paths.some((p) => existsSync(p))).toBe(false);
    expect(git(repo, "branch", "--list", "fd/arena-*")).toBe("");
  });

  test("quem acompanha o board vê só o card da arena, nunca as variantes", async () => {
    const { board, arenaCard, finished } = await setup();
    const seen = new Set<string>();
    cleanups.push(board.watch((card) => seen.add(card.id)));
    await board.startArena(arenaCard.id, { variants: [{}, {}] });
    await finished();
    expect([...seen]).toEqual([arenaCard.id]);
  });

  test("protocolo: card.startArena, card.arena e card.chooseVariant (com confirm)", async () => {
    const { board, manager, arenaCard, finished } = await setup();
    const server = startServer({
      manager,
      board,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const started = await client.data<Arena>("card.startArena", {
      cardId: arenaCard.id,
      variants: [{ effort: "low" }, { effort: "high" }],
    });
    expect(started?.variants.map((v) => v.label)).toEqual(["a", "b"]);
    await finished();
    const listed = await client.data<Arena>("card.arena", { cardId: arenaCard.id });
    const variantId = listed?.variants[1]?.id ?? "";
    expect(
      await client.request("card.chooseVariant", { cardId: arenaCard.id, variantId }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
    expect(
      await client.data<Card>("card.chooseVariant", {
        cardId: arenaCard.id,
        variantId,
        confirm: true,
      }),
    ).toMatchObject({ id: arenaCard.id, branch: "fd/arena-b" });
    expect(
      await client.request("card.startArena", { cardId: arenaCard.id, variants: [{}] }),
    ).toMatchObject({ ok: false, error: { code: "bad_request" } });
  });
});
