import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { NARROW_SHOTS } from "../../lib/shots/narrow.ts";
import { boardShots } from "../../lib/shots/table-board.ts";

const IDS = { project: "p1", diffCard: "c1", idleSession: "s1" } as DemoIds;
const shots = boardShots(IDS);

describe("the Changes prints (#4225)", () => {
  test("the card's Changes tab, its split diff and the session's Changes tab are printed", () => {
    const names = shots.map((shot) => shot.name);
    expect(names.includes("card-mudancas")).toBe(true);
    expect(names.includes("card-mudancas-dividido")).toBe(true);
    expect(names.includes("sessao-mudancas")).toBe(true);
  });

  test("the three are re-measured narrow, so a cramped row or a sideways scroll fails the prints job", () => {
    expect(
      ["card-mudancas", "card-mudancas-dividido", "sessao-mudancas"].filter(
        (name) => !NARROW_SHOTS.includes(name),
      ),
    ).toEqual([]);
  });
});
