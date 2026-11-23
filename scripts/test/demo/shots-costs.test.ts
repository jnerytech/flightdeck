import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { NARROW_SHOTS } from "../../lib/shots/narrow.ts";
import { ALFA } from "../../lib/shots/shot.ts";
import { costsShots } from "../../lib/shots/table-costs.ts";

const IDS = { project: "p1", projectName: "flightdeck-web" } as DemoIds;
const shots = costsShots(IDS);
const named = (name: string) => shots.find((shot) => shot.name === name);

describe("the Costs and ROI prints (#4194)", () => {
  test("the table prints Costs with no cost and after a refused read, the ROI tables refused and the settings panel's states, then the filters, the export lines, the empty ROI tables, the quota charts and the Budgets form, in order", () => {
    expect(shots.map((shot) => shot.name)).toEqual([
      "custos-vazio",
      "custos-recusado",
      "roi-custos-recusado",
      "roi-ajustes",
      "roi-ajustes-salvo",
      "roi-ajustes-numero-ruim",
      "roi-ajustes-pessoa",
      "roi-ajustes-remover",
      "custos-filtros",
      "custos-exportado",
      "custos-exportar-falhou",
      "roi-custos-vazio",
      "custos-cota",
      "custos-cota-recusada",
      "configuracoes-orcamentos-editar",
      "configuracoes-orcamentos-limite",
    ]);
  });

  test("the Costs prints open the Costs screen, the quota charts ones on one host, and the Budgets ones open Settings; the ROI ones are seeded with the ROI settings", () => {
    expect(shots.map((shot) => [shot.name, shot.route])).toEqual([
      ...[
        "custos-vazio",
        "custos-recusado",
        "roi-custos-recusado",
        "roi-ajustes",
        "roi-ajustes-salvo",
        "roi-ajustes-numero-ruim",
        "roi-ajustes-pessoa",
        "roi-ajustes-remover",
        "custos-filtros",
        "custos-exportado",
        "custos-exportar-falhou",
        "roi-custos-vazio",
      ].map((name) => [name, { name: "costs" }]),
      ["custos-cota", { name: "costs", host: ALFA }],
      ["custos-cota-recusada", { name: "costs", host: ALFA }],
      ["configuracoes-orcamentos-editar", { name: "settings" }],
      ["configuracoes-orcamentos-limite", { name: "settings" }],
    ]);
    expect(shots.filter((shot) => shot.roi).map((shot) => shot.name)).toEqual([
      "roi-custos-recusado",
      "roi-ajustes",
      "roi-ajustes-salvo",
      "roi-ajustes-numero-ruim",
      "roi-ajustes-pessoa",
      "roi-ajustes-remover",
      "roi-custos-vazio",
    ]);
  });

  test("the export lines come from the wire: the failed one refuses the export, the saved one leaves it as the host answers", () => {
    expect(named("custos-exportar-falhou")?.wire).toEqual([
      { command: "costs.export", refuse: expect.any(String) },
    ]);
    expect(named("custos-exportado")?.wire ?? null).toBeNull();
    expect(named("custos-filtros")?.wire ?? null).toBeNull();
  });

  test("the empty ROI tables answer every project away, and the charts' refused print refuses the history", () => {
    const rule = named("roi-custos-vazio")?.wire?.find((r) => r.command === "roi.summary");
    const data = (rule && "data" in rule ? rule.data : null) as { projects: unknown[] } | null;
    expect(data?.projects).toEqual([]);
    expect(named("custos-cota-recusada")?.wire).toEqual([
      { command: "quota.history", refuse: expect.any(String) },
    ]);
  });

  test("the quota charts print gives the windows a history to draw", () => {
    const rules = named("custos-cota")?.wire?.filter((r) => r.command === "quota.history") ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      const data = (rule && "data" in rule ? rule.data : null) as { samples: unknown[] } | null;
      expect((data?.samples.length ?? 0) > 1).toBe(true);
    }
  });

  test("the over-limit print lists a budget that crossed its limit; the edit print changes nothing on the wire", () => {
    const rule = named("configuracoes-orcamentos-limite")?.wire?.find(
      (r) => r.command === "budget.list",
    );
    const data = (rule && "data" in rule ? rule.data : null) as {
      budgets: { fraction: number; limitUsd: number; spentUsd: number }[];
    } | null;
    expect(data?.budgets.some((b) => b.fraction >= 1 && b.spentUsd > b.limitUsd)).toBe(true);
    expect(named("configuracoes-orcamentos-editar")?.wire ?? null).toBeNull();
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

  test("Costs, its refused read, the export line, the filters, the charts and the settings panel's errors are re-measured at the narrow sizes", () => {
    for (const name of [
      "custos-vazio",
      "custos-recusado",
      "roi-ajustes",
      "roi-ajustes-numero-ruim",
      "custos-filtros",
      "custos-exportar-falhou",
      "custos-cota",
      "configuracoes-orcamentos-editar",
    ])
      expect([name, NARROW_SHOTS.includes(name)]).toEqual([name, true]);
  });
});
