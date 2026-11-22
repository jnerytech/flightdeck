import { describe, expect, test } from "bun:test";
import { AutomationAction, AutomationRun, AutomationTrigger } from "@flightdeck/protocol";
import { ruleProblem } from "../../../apps/daemon/src/automations/domain/rule-check.ts";
import type { DemoIds } from "../../demo-seed.ts";
import {
  DEMO_AUTOMATIONS,
  DEMO_HISTORY_AUTOMATION,
  DEMO_OFF_AUTOMATION,
} from "../../lib/demo/automations.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { automationShots } from "../../lib/shots/table-automations.ts";

const IDS = { project: "p1", projectName: "web" } as DemoIds;
const SHOTS = () => automationShots(IDS);

describe("the Automations and Workflows prints (#3858)", () => {
  test("the table prints the list, its history, the form's three steps, the turn-on confirmation and the Workflows page", () => {
    expect(SHOTS().map((shot) => shot.name)).toEqual([
      "automacoes-lista",
      "automacoes-historico",
      "automacoes-gatilho",
      "automacoes-acao",
      "automacoes-limite",
      "automacoes-ligar",
      "automacoes-vazio",
      "automacoes-falhou",
      "automacoes-carregando",
      "automacoes-historico-vazio",
      "automacoes-excluir",
      "automacoes-form-erros",
      "automacoes-editar",
      "automacoes-rotulo",
      "automacoes-sem-workflows",
      "automacoes-externos",
      "automacoes-ligar-externo",
      "workflows",
    ]);
  });

  test("each print opens its page on the demo's first host and project", () => {
    const routes = SHOTS().map((shot) => shot.route);
    expect(routes.map((route) => route.name)).toEqual([
      ...Array(17).fill("automations"),
      "workflows",
    ]);
    for (const route of routes) {
      expect(route).toMatchObject({ host: "demo-alfa", projectId: "p1", projectName: "web" });
    }
  });

  test("the list and the Workflows page are re-measured narrow, in the dark prints", () => {
    expect(narrowSizes("dark", "automacoes-lista")).toHaveLength(3);
    expect(narrowSizes("dark", "workflows")).toHaveLength(3);
  });

  test("the form's first step and its errors are re-measured narrow too (#4190)", () => {
    expect(narrowSizes("dark", "automacoes-gatilho")).toHaveLength(3);
    expect(narrowSizes("dark", "automacoes-form-erros")).toHaveLength(3);
  });

  test("the empty, failed and loading prints change the host's answer to the automations, and the no-workflow print its workflows (#4190)", () => {
    const wire = (name: string) => SHOTS().find((shot) => shot.name === name)?.wire;
    expect(wire("automacoes-vazio")).toEqual([
      { command: "automation.list", data: { automations: [] } },
    ]);
    expect(wire("automacoes-falhou")).toEqual([
      { command: "automation.list", refuse: "The automations could not be read." },
    ]);
    expect(wire("automacoes-carregando")).toEqual([{ command: "automation.list", hold: true }]);
    expect(wire("automacoes-sem-workflows")).toEqual([
      { command: "workflow.list", data: { workflows: [] } },
    ]);
  });

  test("the prints that open a seeded row leave the host's answers as the seed gives them (#4190)", () => {
    for (const name of [
      "automacoes-historico-vazio",
      "automacoes-excluir",
      "automacoes-form-erros",
      "automacoes-editar",
      "automacoes-rotulo",
      "automacoes-externos",
      "automacoes-ligar-externo",
    ]) {
      const shot = SHOTS().find((one) => one.name === name);
      expect({ name, printed: shot !== undefined, wire: shot?.wire }).toEqual({
        name,
        printed: true,
        wire: undefined,
      });
    }
  });
});

describe("the automations the demo seeds (#3858)", () => {
  test("one is on, one is off and takes outside authors, and the names are different", () => {
    const names = DEMO_AUTOMATIONS.map((a) => a.name);
    expect(names.length).toBeGreaterThanOrEqual(3);
    expect(new Set(names).size).toBe(names.length);
    expect(DEMO_AUTOMATIONS.filter((a) => a.enabled)).toHaveLength(1);
    expect(DEMO_AUTOMATIONS.some((a) => !a.enabled && a.allowExternalAuthors)).toBe(true);
  });

  test("each one is a rule the daemon accepts, and the on one fires from no clock", () => {
    for (const auto of DEMO_AUTOMATIONS) {
      expect(AutomationTrigger.safeParse(auto.trigger).success).toBe(true);
      expect(AutomationAction.safeParse(auto.action).success).toBe(true);
      expect(ruleProblem(auto.trigger, auto.action)).toBeNull();
    }
    // A cron or a label search that is on would fire during the prints and change the demo.
    const on = DEMO_AUTOMATIONS.find((a) => a.enabled);
    expect(on?.trigger.type).toBe("ci_failed");
  });

  test("the history print opens the on automation, whose firings show every kind of outcome; the turn-on print names an off one", () => {
    const history = DEMO_AUTOMATIONS.find((a) => a.name === DEMO_HISTORY_AUTOMATION);
    expect(history?.enabled).toBe(true);
    const runs = history?.runs ?? [];
    for (const run of runs) {
      const parsed = AutomationRun.safeParse({ id: "r", automationId: "a", ...run });
      expect(parsed.success).toBe(true);
    }
    // The outcomes a failing-checks trigger can have; "ignored" needs an outside author's event.
    expect(new Set(runs.map((run) => run.status))).toEqual(new Set(["ok", "failed", "limited"]));
    expect(DEMO_AUTOMATIONS.find((a) => a.name === DEMO_OFF_AUTOMATION)?.enabled).toBe(false);
  });
});
