import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { DemoIds } from "../../demo-seed.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { boardShots } from "../../lib/shots/table-board.ts";
import { recordingPage } from "./recording-page.ts";

const ids = { project: "p1" } as DemoIds;
const shots = () => boardShots(ids);

const PLAIN = "Definir o esquema do carrinho";
const STARTED = "Revisar o fluxo de login";
const actions = (title: string) => `click button[Actions for ${title}]`;
const TOAST = 'waitFor locator[[data-sonner-toast][data-mounted="true"]]';

/** Name → what the print drives on the page, in order, once the board is open. */
const STEPS: Array<[string, string[]]> = [
  ["board-erro", ["waitFor button[Try again]", TOAST]],
  ["board-filtro-vazio", ['fill "no-such-card" label[Filter cards]', "waitFor text[No matches]"]],
  ["board-apagar", [actions(PLAIN), "click menuitem[Delete…]", "waitFor alertdialog[]"]],
  ["board-apagar-iniciado", [actions(STARTED), "click menuitem[Delete…]", "waitFor alertdialog[]"]],
  [
    "board-descartar",
    [
      actions(PLAIN),
      "click menuitem[Select card]",
      actions(STARTED),
      "click menuitem[Select card]",
      "click group[Selection] > button[Discard…]",
      "waitFor alertdialog[]",
    ],
  ],
  [
    "board-card-novo-coluna",
    [
      "click button[Add card to Backlog]",
      "waitFor dialog[]",
      "waitFor text[Give the card a title]",
    ],
  ],
];

const named = (name: string) => shots().find((shot) => shot.name === name);

describe("the Board state prints (#4410)", () => {
  test("the table lists each state after the plain board", () => {
    const names = shots().map((shot) => shot.name);
    expect(STEPS.map(([name]) => names.includes(name))).toEqual(STEPS.map(() => true));
  });

  test("each state is the board of the demo project, with steps of its own", () => {
    expect(STEPS.map(([name]) => [named(name)?.route, named(name)?.prepare !== undefined])).toEqual(
      STEPS.map(() => [{ name: "board", host: "demo-alfa", projectId: "p1" }, true]),
    );
  });

  test("the load failure is the host refusing board.get", () => {
    expect(named("board-erro")?.wire).toEqual([
      { command: "board.get", refuse: "The board could not be read." },
    ]);
  });

  test("only the load failure changes what the host answers", () => {
    expect(STEPS.filter(([name]) => named(name)?.wire !== undefined).map(([name]) => name)).toEqual(
      ["board-erro"],
    );
  });

  test("each state is re-measured narrow, where the dialogs and the column must fit", () => {
    expect(STEPS.map(([name]) => narrowSizes("dark", name).length)).toEqual(STEPS.map(() => 3));
  });

  test("the empty board keeps its print, which is re-measured narrow too", () => {
    expect(narrowSizes("dark", "projeto-vazio")).toHaveLength(3);
  });

  test.each(STEPS)("%s drives the page the way its state needs", async (name, expected) => {
    const { page, steps } = recordingPage();
    await named(name)?.prepare?.(page);
    expect(steps).toEqual(expected);
  });

  test("demo:shots prints the table", () => {
    expect(readFileSync("scripts/demo-shots.ts", "utf8")).toContain("...boardShots(ids)");
  });
});
