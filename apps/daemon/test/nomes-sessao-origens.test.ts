import { afterEach, describe, expect, test } from "bun:test";
import { ExternalSessions } from "../src/central/external.ts";
import { Names } from "../src/names/names.ts";
import { type TrackOptions, trackNames } from "../src/names/track.ts";
import { cardWhen, newBoard } from "./board-helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Real manager, board and terminal sessions over one store; the tracker starts when asked. */
function rig(over: Partial<TrackOptions> = {}) {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const external = new ExternalSessions({ db: ctx.store.db, staleAfterS: 900 });
  const names = new Names(ctx.store.db);
  const options: TrackOptions = {
    names,
    manager: ctx.manager,
    external,
    projectOf: (cwd) => ctx.board.projectForCwd(cwd)?.project.path ?? cwd,
    cardOf: (id) => ctx.board.projectForCwd(ctx.manager.get(id).cwd)?.card?.id ?? null,
    ...over,
  };
  const start = () => {
    const stop = trackNames(options);
    cleanups.push(stop);
    return stop;
  };
  const create = (name: string | null = null) =>
    ctx.manager.create({ cwd: ctx.repo, prompt: "oi", ...(name ? { name } : {}) }).sessionId;
  return { ...ctx, external, names, start, create };
}

const display = (names: Names, id: string) => names.get(id)?.display ?? null;

describe("nomes-sessao: as origens", () => {
  test("a sessão do app ganha nome ao ser criada, com o nome da pasta do projeto", () => {
    const { names, start, create } = rig();
    start();
    const first = create("Corrigir login");
    const second = create();
    expect(display(names, first)).toBe("repo · geral · 1");
    expect(display(names, second)).toBe("repo · geral · 2");
    expect(names.resolve("repo-geral-2")).toBe(second);
  });

  test("a sessão do terminal ganha nome no primeiro SessionStart e o resto dos eventos não mexe", () => {
    const { names, external, start } = rig();
    start();
    external.apply("SessionStart", { session_id: "t1", cwd: "/work/loja", launch_id: "L1" });
    external.apply("UserPromptSubmit", { session_id: "t1", cwd: "/work/loja" });
    external.apply("Stop", { session_id: "t1", cwd: "/work/loja" });
    expect(display(names, "t1")).toBe("loja · geral · 1");
    expect(names.list()).toHaveLength(1);
  });

  test("o claude puro visto pelos hooks também ganha nome, e sem pasta vale sem-projeto", () => {
    const { names, external, start } = rig();
    start();
    external.apply("SessionStart", { session_id: "p1", cwd: "/work/loja" });
    external.apply("SessionStart", { session_id: "p2" });
    expect(display(names, "p1")).toBe("loja · geral · 1");
    expect(display(names, "p2")).toBe("sem-projeto · geral · 1");
  });

  test("a sessão de um card leva o número do card, e a do segundo card o seu", async () => {
    const { names, board, repo, start } = rig();
    start();
    const project = await board.addProject({ path: repo });
    const a = board.createCard(project.id, { title: "Primeiro", description: "d" });
    const b = board.createCard(project.id, { title: "Segundo", description: "d" });
    await board.startCard(a.id);
    await board.startCard(b.id);
    const ran = await cardWhen(board, a.id, (c) => c.sessionId !== null);
    const ranB = await cardWhen(board, b.id, (c) => c.sessionId !== null);
    expect(display(names, ran?.sessionId as string)).toBe("repo · geral · card 1");
    expect(display(names, ranB?.sessionId as string)).toBe("repo · geral · card 2");
  });

  test("a persona que a sessão já tem entra no nome", () => {
    const { names, start, create } = rig({ personaOf: () => "revisor" });
    start();
    expect(display(names, create())).toBe("repo · revisor · 1");
  });

  test("as sessões que já existiam quando o rastreio começa ganham nome, na ordem em que nasceram", () => {
    const { names, external, start, create } = rig();
    const first = create();
    const second = create();
    external.apply("SessionStart", { session_id: "t1", cwd: "/work/loja" });
    expect(names.list()).toHaveLength(0);
    start();
    expect(display(names, first)).toBe("repo · geral · 1");
    expect(display(names, second)).toBe("repo · geral · 2");
    expect(display(names, "t1")).toBe("loja · geral · 1");
  });

  test("parado, o rastreio não nomeia mais nada", () => {
    const { names, external, start, create } = rig();
    const stop = start();
    const before = create();
    stop();
    create();
    external.apply("SessionStart", { session_id: "t1", cwd: "/work/loja" });
    expect(names.list().map((n) => n.id)).toEqual([before]);
  });
});
