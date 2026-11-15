import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { automationsRig, code, NET, UTC } from "../support/automations.ts";

setDefaultTimeout(NET * 2);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const { fake, setup } = automationsRig(cleanups);

describe("automacoes", () => {
  test("nasce desligada; ligar pede confirm; editar desliga de novo; desligar não pede confirm", async () => {
    const { automations, created } = await setup();
    const a = created();
    expect(a).toMatchObject({ enabled: false, maxRunsPerDay: 10, allowExternalAuthors: false });
    expect(await code(() => automations.toggle(a.id, true, false))).toBe("invalid_state");
    expect(automations.list(a.projectId)[0]?.enabled).toBe(false);
    expect(automations.toggle(a.id, true, true).enabled).toBe(true);
    const edited = automations.save({
      projectId: a.projectId,
      id: a.id,
      name: "Outro nome",
      trigger: a.trigger,
      action: a.action,
      maxRunsPerDay: 3,
    });
    expect(edited).toMatchObject({
      id: a.id,
      name: "Outro nome",
      enabled: false,
      maxRunsPerDay: 3,
    });
    automations.toggle(a.id, true, true);
    expect(automations.toggle(a.id, false, false).enabled).toBe(false);
  });

  test("a validação recusa cron, fuso, combinação e projeto inválidos", async () => {
    const { created, project } = await setup();
    const bad = async (over: Parameters<typeof created>[0]) => code(() => created(over));
    expect(await bad({ trigger: { type: "cron", expr: "61 * * * *", tz: "UTC" } })).toBe(
      "bad_request",
    );
    expect(await bad({ trigger: { type: "cron", expr: "* * * *", tz: "UTC" } })).toBe(
      "bad_request",
    );
    expect(await bad({ trigger: { type: "cron", expr: "a * * * *", tz: "UTC" } })).toBe(
      "bad_request",
    );
    expect(await bad({ trigger: { type: "cron", expr: "1-2-3 * * * *", tz: "UTC" } })).toBe(
      "bad_request",
    );
    expect(await bad({ trigger: { type: "cron", expr: "*/0 * * * *", tz: "UTC" } })).toBe(
      "bad_request",
    );
    expect(await bad({ trigger: { type: "cron", expr: "* * * * *", tz: "Marte/Olimpo" } })).toBe(
      "bad_request",
    );
    expect(await bad({ action: { type: "send_to_card" } })).toBe("bad_request");
    expect(await bad({ trigger: { type: "ci_failed" }, action: { type: "create_card" } })).toBe(
      "bad_request",
    );
    expect(await bad({ maxRunsPerDay: 0 })).toBe("bad_request");
    expect(await bad({ projectId: "nao-existe" })).toBe("not_found");
    expect(await bad({ id: "nao-existe", projectId: project.id })).toBe("not_found");
  });

  test("listar por projeto, remover pede confirm e leva as execuções, histórico do mais novo e com limite", async () => {
    const { automations, created, project, time } = await setup();
    const a = created({ name: "A" });
    created({ name: "B" });
    expect(automations.list(project.id).map((x) => x.name)).toEqual(["A", "B"]);
    automations.toggle(a.id, true, true);
    for (const minute of ["12:00", "12:01", "12:02"]) {
      time.now = UTC(`2026-10-05T${minute}:00Z`);
      await automations.tick(time.now);
    }
    expect(automations.runs(a.id).map((r) => r.firedAt)).toEqual([
      "2026-10-05T12:02:00.000Z",
      "2026-10-05T12:01:00.000Z",
      "2026-10-05T12:00:00.000Z",
    ]);
    expect(automations.runs(a.id, 2)).toHaveLength(2);
    expect(await code(() => automations.remove(a.id, false))).toBe("invalid_state");
    expect(automations.remove(a.id, true).map((x) => x.name)).toEqual(["B"]);
    expect(automations.runs(a.id)).toEqual([]);
    expect(await code(() => automations.remove("nao-existe", true))).toBe("not_found");
  });
});

describe("automacoes: the refusals carry a reason", () => {
  test("cron, time zone, trigger and action combinations, limits, confirmations and unknown ids", async () => {
    const { automations, created, project } = await setup();
    const reason = async (fn: () => unknown) => {
      try {
        await fn();
      } catch (error) {
        const e = error as { reason?: string; params?: unknown; message: string };
        return [e.reason, e.params, /[à-ú]/.test(e.message)];
      }
      return null;
    };
    const cron = (expr: string, tz = "UTC") => ({ trigger: { type: "cron" as const, expr, tz } });
    expect(await reason(() => created(cron("* * * *")))).toEqual(["cron_fields", undefined, false]);
    expect(await reason(() => created(cron("61 * * * *")))).toEqual([
      "cron_range",
      { field: 1, min: 0, max: 59, part: "61" },
      false,
    ]);
    expect(await reason(() => created(cron("a * * * *")))).toEqual([
      "cron_value",
      { field: 1, part: "a" },
      false,
    ]);
    expect(await reason(() => created(cron("*/0 * * * *")))).toEqual([
      "cron_step",
      { field: 1, part: "*/0" },
      false,
    ]);
    expect(await reason(() => created(cron("* * * * *", "Marte/Olimpo")))).toEqual([
      "automation_tz_unknown",
      { tz: "Marte/Olimpo" },
      false,
    ]);
    expect((await reason(() => created({ action: { type: "send_to_card" } })))?.[0]).toBe(
      "automation_send_needs_card",
    );
    expect(
      (
        await reason(() =>
          created({ trigger: { type: "ci_failed" }, action: { type: "create_card" } }),
        )
      )?.[0],
    ).toBe("automation_create_needs_label");
    expect((await reason(() => created({ maxRunsPerDay: 0 })))?.[0]).toBe("automation_max_runs");
    expect((await reason(() => created({ name: " " })))?.[0]).toBe("automation_name_required");
    expect(await reason(() => created({ id: "nope", projectId: project.id }))).toEqual([
      "automation_not_found",
      { id: "nope" },
      false,
    ]);
    const a = created();
    expect((await reason(() => automations.toggle(a.id, true, false)))?.[0]).toBe(
      "automation_enable_confirm",
    );
    expect((await reason(() => automations.remove(a.id, false)))?.[0]).toBe(
      "automation_remove_confirm",
    );
    expect((await reason(() => automations.remove("nope", true)))?.[0]).toBe(
      "automation_not_found",
    );
  });
});
