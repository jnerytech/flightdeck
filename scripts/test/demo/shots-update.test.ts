import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { NARROW_SHOTS } from "../../lib/shots/narrow.ts";
import { shellShots } from "../../lib/shots/table-shell.ts";

const updateShots = () =>
  shellShots({} as DemoIds).filter(
    (shot) => shot.name.startsWith("atualizacao-") || shot.name.startsWith("novidades"),
  );

// #4059: the update banner, its error and the What's new dialog have prints of their own.
describe("the update flow prints (#4059)", () => {
  test("the table prints the banner, the banner's error and the four states of What's new, in that order", () => {
    expect(updateShots().map((shot) => shot.name)).toEqual([
      "atualizacao-faixa",
      "atualizacao-faixa-erro",
      "novidades-carregando",
      "novidades-vazio",
      "novidades-erro",
      "novidades",
    ]);
  });

  test("the banner needs the automatic update off, and the corner card's print does not", () => {
    const shots = shellShots({} as DemoIds);
    const switches = (name: string) => {
      const shot = shots.find((candidate) => candidate.name === name);
      return [shot?.query?.update, shot?.autoUpdateOff === true];
    };
    expect([
      switches("atualizacao-faixa"),
      switches("atualizacao-faixa-erro"),
      switches("aviso-atualizacao"),
    ]).toEqual([
      ["9.9.9", true],
      ["fail", false],
      ["9.9.9", false],
    ]);
  });

  test("each What's new print answers its own way: loading, no feed, a refusal, the list", () => {
    expect(updateShots().map((shot) => shot.releases)).toEqual([
      undefined,
      undefined,
      "loading",
      "none",
      "error",
      "list",
    ]);
  });

  test("the list is re-measured narrow, where the dialog takes the window and its footer is a column", () => {
    expect(NARROW_SHOTS).toContain("novidades");
  });
});
