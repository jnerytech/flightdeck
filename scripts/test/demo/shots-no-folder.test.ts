import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { NARROW_SHOTS } from "../../lib/shots/narrow.ts";
import { ALFA } from "../../lib/shots/shot.ts";
import { shellShots } from "../../lib/shots/table-shell.ts";

const shot = () => shellShots({} as DemoIds).find((s) => s.name === "nova-sessao-sem-pasta");

// #4388: New session on a host with no allowed folder had no print, so no axe check and no 390 px look.
describe("the New session print of a host with no allowed folder (#4388)", () => {
  test("it opens the form of the first host and takes every allowed folder out of its hello", () => {
    expect(shot()?.route).toEqual({ name: "new-session", host: ALFA });
    expect(shot()?.wire).toEqual([{ command: "hello", without: { allowedRoots: ["*"] } }]);
  });

  test("it is measured at 390 px, where the reason and its link wrap", () => {
    expect(NARROW_SHOTS).toContain("nova-sessao-sem-pasta");
  });
});
