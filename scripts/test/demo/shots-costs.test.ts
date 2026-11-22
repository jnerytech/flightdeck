import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { NARROW_SHOTS } from "../../lib/shots/narrow.ts";
import { costsShots } from "../../lib/shots/table-costs.ts";

const IDS = { project: "p1", projectName: "flightdeck-web" } as DemoIds;
const shots = costsShots(IDS);
const named = (name: string) => shots.find((shot) => shot.name === name);

describe("the Costs and ROI prints (#4194)", () => {
  test("the table prints Costs with no cost and after a refused read, then the ROI tables refused and the settings panel's states, in order", () => {
    expect(shots.map((shot) => shot.name)).toEqual([
      "custos-vazio",
      "custos-recusado",
      "roi-custos-recusado",
      "roi-ajustes",
      "roi-ajustes-salvo",
      "roi-ajustes-numero-ruim",
      "roi-ajustes-pessoa",
      "roi-ajustes-remover",
    ]);
  });

  test("every print opens the Costs screen, and the ROI ones are seeded with the ROI settings", () => {
    expect(shots.map((shot) => shot.route.name)).toEqual(shots.map(() => "costs"));
    expect(shots.filter((shot) => shot.roi).map((shot) => shot.name)).toEqual([
      "roi-custos-recusado",
      "roi-ajustes",
      "roi-ajustes-salvo",
      "roi-ajustes-numero-ruim",
      "roi-ajustes-pessoa",
      "roi-ajustes-remover",
    ]);
  });

  test("the empty print answers a period with no cost, and the refused ones refuse the read", () => {
    const rule = named("custos-vazio")?.wire?.find((r) => r.command === "costs.summary");
    const data = (rule && "data" in rule ? rule.data : null) as {
      totals: { costUsd: number; messages: number };
      byDay: unknown[];
      topSessions: unknown[];
    } | null;
    expect({
      cost: data?.totals.costUsd,
      messages: data?.totals.messages,
      days: data?.byDay.length,
      sessions: data?.topSessions.length,
    }).toEqual({ cost: 0, messages: 0, days: 0, sessions: 0 });
    expect(named("custos-recusado")?.wire).toEqual([
      { command: "costs.summary", refuse: expect.any(String) },
    ]);
    expect(named("roi-custos-recusado")?.wire).toEqual([
      { command: "roi.summary", refuse: expect.any(String) },
    ]);
  });

  test("the settings prints change nothing on the wire: the panel is the one that saves in the page", () => {
    expect(
      shots
        .filter((shot) => shot.name.startsWith("roi-ajustes"))
        .map((shot) => [shot.name, shot.wire ?? null]),
    ).toEqual([
      ["roi-ajustes", null],
      ["roi-ajustes-salvo", null],
      ["roi-ajustes-numero-ruim", null],
      ["roi-ajustes-pessoa", null],
      ["roi-ajustes-remover", null],
    ]);
  });

  test("Costs, its refused read and the settings panel's errors are re-measured at the narrow sizes", () => {
    for (const name of [
      "custos-vazio",
      "custos-recusado",
      "roi-ajustes",
      "roi-ajustes-numero-ruim",
    ])
      expect([name, NARROW_SHOTS.includes(name)]).toEqual([name, true]);
  });
});
