import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { changesShots } from "../../lib/shots/table-changes.ts";

const IDS = { project: "p1", diffCard: "c1", idleSession: "s1" } as DemoIds;
const shots = changesShots(IDS);
const names = shots.map((shot) => shot.name);

/** The states of the Changes tab the prints did not show (#4229), as the issue lists them. */
const STATES = [
  "card-mudancas-reverter",
  "card-mudancas-desfazer",
  "card-mudancas-editor",
  "card-mudancas-conflito",
  "card-mudancas-editor-recusado",
  "card-mesclar",
  "card-mesclar-recusado",
  "card-pr-comentarios",
  "card-pr-comentarios-vazio",
  "card-pr-comentarios-falhou",
  "card-mudancas-comentario-editando",
  "card-mudancas-enviados",
  "card-mudancas-arquivos",
  "card-mudancas-falhou",
  "card-mudancas-vazio",
];

describe("the Changes states' prints (#4229)", () => {
  test("every state of the issue has a print of its own", () => {
    expect(STATES.filter((name) => !names.includes(name))).toEqual([]);
  });

  test("no name is printed twice", () => {
    expect(names.length).toBe(new Set(names).size);
  });

  test("a state the host cannot be left in is a wire rule, so the demo's hosts stay as they are", () => {
    const wired = ["card-mudancas-falhou", "card-mudancas-vazio", "card-mudancas-arquivos"];
    expect(
      wired.filter((name) => (shots.find((shot) => shot.name === name)?.wire?.length ?? 0) === 0),
    ).toEqual([]);
  });
});
