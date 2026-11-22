import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { DEMO_PAUSED_TEAM, DEMO_QUOTA_TEAM } from "../../lib/e2e/journeys.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { hostShots } from "../../lib/shots/table-hosts.ts";

const teamShots = () => hostShots({} as DemoIds).filter((shot) => shot.name.startsWith("times-"));

// #4025: the Teams footer, the paused team and the team the quota paused have prints of their own.
describe("the Teams prints (#4025)", () => {
  test("the table prints the running team's footer, its Add worker form, the paused team and the quota-paused team after the ones that exist", () => {
    expect(teamShots().map((shot) => shot.name)).toEqual([
      "times-apagar",
      "times-novo",
      "times-rodando",
      "times-rodape",
      "times-adicionar",
      "times-pausado",
      "times-cota",
    ]);
    expect(teamShots().every((shot) => shot.route.name === "teams")).toBe(true);
  });

  test("the demo keeps a team paused by the person and one paused by the quota, with names of their own", () => {
    expect(DEMO_PAUSED_TEAM).toBe("paused-crew");
    expect(DEMO_QUOTA_TEAM).toBe("quota-crew");
  });

  test("each new print is re-measured narrow in the dark prints, where the footer wraps", () => {
    for (const name of ["times-rodape", "times-adicionar", "times-pausado", "times-cota"]) {
      expect(narrowSizes("dark", name).map((size) => size.width)).toEqual([1024, 640, 390]);
      expect(narrowSizes("light", name)).toEqual([]);
    }
  });
});
