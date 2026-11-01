import { describe, expect, test } from "bun:test";
import {
  type Day,
  evaluate,
  localTime,
  type Rule,
  type RulesEnv,
  type UseContext,
  validateRules,
} from "../src/vault/rules.ts";

/** Wednesday 2026-10-28, 15:00 UTC (12:00 in a UTC-3 PC). */
const NOW = Date.UTC(2026, 9, 28, 15, 0, 0);
const HOUR = 3_600_000;
const DAYS: Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** A PC at `offsetHours` from UTC, and the uses each rule already let through. */
function env(
  over: { now?: number; offsetHours?: number; uses?: Record<string, number> } = {},
): RulesEnv & { asked: Array<{ ruleId: string; sinceMs: number }> } {
  const asked: Array<{ ruleId: string; sinceMs: number }> = [];
  const offset = (over.offsetHours ?? -3) * HOUR;
  return {
    asked,
    now: () => over.now ?? NOW,
    local: (ms) => {
      const shifted = new Date(ms + offset);
      return {
        day: DAYS[shifted.getUTCDay()] as Day,
        minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
      };
    },
    uses: (ruleId, sinceMs) => {
      asked.push({ ruleId, sinceMs });
      return over.uses?.[ruleId] ?? 0;
    },
  };
}

const use = (over: Partial<UseContext> = {}): UseContext => ({
  secretId: "deploy-token",
  requester: "claude",
  purpose: "action",
  action: "deploy-staging",
  host: "vps",
  tags: [],
  ...over,
});

const rule = (over: Partial<Rule> & { id: string }): Rule => ({
  match: {},
  decision: "allow",
  ...over,
});

const at = (hours: number, minutes = 0, base = NOW) => {
  const midnightLocal = Math.floor((base - 3 * HOUR) / (24 * HOUR)) * 24 * HOUR + 3 * HOUR;
  return midnightLocal + hours * HOUR + minutes * 60_000;
};

describe("regras-modelo: qual regra vale", () => {
  test("a primeira que casa vale, mesmo que uma depois também case", () => {
    const rules = [
      rule({ id: "negar-automacao", match: { requester: "automation" }, decision: "deny" }),
      rule({ id: "liberar-staging", match: { action: "deploy-staging" }, decision: "allow" }),
      rule({ id: "tudo", decision: "deny" }),
    ];
    expect(evaluate(rules, use(), env())).toMatchObject({
      decision: "allow",
      ruleId: "liberar-staging",
    });
    expect(evaluate(rules, use({ requester: "automation" }), env())).toMatchObject({
      decision: "deny",
      ruleId: "negar-automacao",
    });
    expect(evaluate(rules, use({ action: "outra" }), env())).toMatchObject({ ruleId: "tudo" });
  });

  test("sem regra que case vale o padrão, e o motivo diz que foi o padrão", () => {
    const verdict = evaluate(
      [rule({ id: "so-automacao", match: { requester: "automation" } })],
      use(),
      env(),
    );
    expect(verdict.ruleId).toBeNull();
    expect(verdict.reason).toContain("padrão");
    expect(evaluate([], use(), env()).ruleId).toBeNull();
  });

  test("cada campo de match, combinado com E, e uma regra sem match casa com tudo", () => {
    const cases: Array<[string, Rule["match"], Partial<UseContext>, Partial<UseContext>]> = [
      ["requester", { requester: "claude" }, {}, { requester: "automation" }],
      ["purpose", { purpose: "ssh" }, { purpose: "ssh" }, { purpose: "action" }],
      ["host", { host: "vps" }, {}, { host: "outro" }],
      ["project", { project: "github.com/acme/app" }, { project: "github.com/acme/app" }, {}],
      ["session", { session: "s1" }, { session: "s1" }, { session: "s2" }],
      ["action", { action: "deploy-staging" }, {}, { action: "deploy-prod" }],
      ["tags", { tags: ["staging"] }, { tags: ["staging", "api"] }, { tags: ["api"] }],
    ];
    for (const [name, match, yes, no] of cases) {
      const rules = [rule({ id: name, match, decision: "allow" })];
      expect(evaluate(rules, use(yes), env()).ruleId).toBe(name);
      expect(evaluate(rules, use(no), env()).ruleId).toBeNull();
    }
    // All of them have to hold.
    const both = [rule({ id: "e", match: { requester: "claude", host: "vps" } })];
    expect(evaluate(both, use(), env()).ruleId).toBe("e");
    expect(evaluate(both, use({ host: "outro" }), env()).ruleId).toBeNull();
    expect(evaluate(both, use({ requester: "workflow" }), env()).ruleId).toBeNull();
    expect(evaluate([rule({ id: "vazia" })], use({ requester: "workflow" }), env()).ruleId).toBe(
      "vazia",
    );
  });

  test("o que a regra exige e o uso não tem não casa: sem ação, sem projeto, sem sessão", () => {
    const { action, ...noAction } = use();
    expect(action).toBe("deploy-staging");
    for (const match of [{ action: "*" }, { project: "p" }, { session: "s" }, { tags: ["x"] }]) {
      const verdict = evaluate([rule({ id: "r", match })], noAction, env());
      expect(verdict.ruleId).toBeNull();
    }
  });

  test("a ação aceita o curinga *, sem tratar o resto como regex, e as tags ignoram a caixa", () => {
    const wildcard = (pattern: string, action: string) =>
      evaluate([rule({ id: "r", match: { action: pattern } })], use({ action }), env()).ruleId;
    expect(wildcard("deploy-*", "deploy-staging")).toBe("r");
    expect(wildcard("deploy-*", "logs-prod")).toBeNull();
    expect(wildcard("*", "qualquer")).toBe("r");
    expect(wildcard("*-prod", "logs-prod")).toBe("r");
    expect(wildcard("a.c", "abc")).toBeNull();
    expect(wildcard("a.c", "a.c")).toBe("r");
    expect(wildcard("deploy-*", "meu-deploy-x")).toBeNull();
    const tagged = evaluate(
      [rule({ id: "t", match: { tags: ["PROD"] } })],
      use({ tags: ["prod"] }),
      env(),
    );
    expect(tagged.ruleId).toBe("t");
  });
});

describe("regras-modelo: janela, limites e expiração", () => {
  const window = (over: Partial<Rule> = {}): Rule =>
    rule({
      id: "util",
      match: { tags: ["staging"] },
      decision: "allow",
      window: { days: ["mon", "tue", "wed", "thu", "fri"], from: "08:00", to: "18:00" },
      ...over,
    });
  const staging = use({ tags: ["staging"] });

  test("dentro da janela vale a decisão da regra; fora, o outsideWindow, que por padrão é deny", () => {
    expect(evaluate([window()], staging, env({ now: at(12) }))).toMatchObject({
      decision: "allow",
      ruleId: "util",
    });
    for (const [h, m] of [
      [7, 59],
      [18, 0],
      [22, 0],
    ] as const) {
      const out = evaluate([window()], staging, env({ now: at(h, m) }));
      expect(out).toMatchObject({ decision: "deny", ruleId: "util" });
      expect(out.reason).toContain("janela");
    }
    expect(evaluate([window()], staging, env({ now: at(8, 0) })).decision).toBe("allow");
    expect(evaluate([window()], staging, env({ now: at(17, 59) })).decision).toBe("allow");
  });

  test("os dias contam: no sábado a janela de dias úteis está fechada; outsideWindow pode ser ask", () => {
    const saturday = at(12) + 3 * 24 * HOUR;
    expect(evaluate([window()], staging, env({ now: saturday })).decision).toBe("deny");
    const asks = window({ outsideWindow: "ask" });
    expect(evaluate([asks], staging, env({ now: saturday }))).toMatchObject({ decision: "ask" });
    expect(evaluate([asks], staging, env({ now: at(12) })).decision).toBe("allow");
  });

  test("a janela é no fuso do PC injetado", () => {
    const evening = Date.UTC(2026, 9, 28, 20, 0, 0);
    expect(evaluate([window()], staging, env({ now: evening, offsetHours: -3 })).decision).toBe(
      "allow",
    );
    expect(evaluate([window()], staging, env({ now: evening, offsetHours: 0 })).decision).toBe(
      "deny",
    );
  });

  test("uma janela que passa da meia-noite vale para o dia em que começou", () => {
    const night = window({
      window: { days: ["fri"], from: "22:00", to: "06:00" },
    });
    const friday = at(12) + 2 * 24 * HOUR;
    expect(evaluate([night], staging, env({ now: friday + 11 * HOUR })).decision).toBe("allow");
    expect(evaluate([night], staging, env({ now: friday + 14 * HOUR })).decision).toBe("allow");
    // Saturday noon, and Saturday 23:00 (a night that did not start on a Friday), are outside.
    expect(evaluate([night], staging, env({ now: friday + 24 * HOUR })).decision).toBe("deny");
    expect(evaluate([night], staging, env({ now: friday + 35 * HOUR })).decision).toBe("deny");
    // Friday early morning belongs to Thursday night, which is not listed.
    expect(evaluate([night], staging, env({ now: friday - 8 * HOUR })).decision).toBe("deny");
  });

  test("maxPerHour e maxPerDay: estourou, vira deny com aviso até o período virar", () => {
    const limited = rule({ id: "lim", maxPerHour: 3, maxPerDay: 10 });
    const e = env({ uses: { lim: 2 } });
    expect(evaluate([limited], use(), e)).toMatchObject({ decision: "allow", limited: false });
    expect(e.asked).toContainEqual({ ruleId: "lim", sinceMs: NOW - HOUR });
    expect(e.asked).toContainEqual({ ruleId: "lim", sinceMs: NOW - 24 * HOUR });

    const hourly = evaluate([limited], use(), env({ uses: { lim: 3 } }));
    expect(hourly).toMatchObject({ decision: "deny", ruleId: "lim", limited: true });
    expect(hourly.reason).toContain("por hora");

    // 3 in the last hour is the limit; 10 in the day is the other.
    const daily = evaluate([rule({ id: "dia", maxPerDay: 10 })], use(), env({ uses: { dia: 10 } }));
    expect(daily).toMatchObject({ decision: "deny", limited: true });
    expect(daily.reason).toContain("por dia");
  });

  test("o limite vale também para ask; uma regra deny ou sem limite não consulta o histórico", () => {
    const asked = rule({ id: "pergunta", decision: "ask", maxPerHour: 1 });
    expect(evaluate([asked], use(), env({ uses: { pergunta: 1 } }))).toMatchObject({
      decision: "deny",
      limited: true,
    });
    const e = env();
    evaluate([rule({ id: "nega", decision: "deny", maxPerHour: 1 })], use(), e);
    evaluate([rule({ id: "livre" })], use(), e);
    expect(e.asked).toEqual([]);
  });

  test("expiresAt: antes do prazo a regra vale; no prazo ou depois ela é pulada", () => {
    const temp = [
      rule({ id: "temporaria", expiresAt: NOW + 1 }),
      rule({ id: "depois", decision: "ask" }),
    ];
    expect(evaluate(temp, use(), env()).ruleId).toBe("temporaria");
    expect(evaluate(temp, use(), env({ now: NOW + 1 })).ruleId).toBe("depois");
    expect(evaluate(temp, use(), env({ now: NOW + HOUR })).ruleId).toBe("depois");
  });
});

describe("regras-modelo: o fuso", () => {
  test("localTime dá o dia e a hora de um instante num fuso", () => {
    const instant = Date.UTC(2026, 9, 28, 2, 30, 0);
    expect(localTime(instant, "UTC")).toEqual({ day: "wed", minutes: 150 });
    expect(localTime(instant, "America/Sao_Paulo")).toEqual({ day: "tue", minutes: 23 * 60 + 30 });
    expect(localTime(instant, "Asia/Tokyo")).toEqual({ day: "wed", minutes: 11 * 60 + 30 });
    const local = localTime(instant);
    expect(DAYS).toContain(local.day);
    expect(local.minutes).toBeGreaterThanOrEqual(0);
    expect(local.minutes).toBeLessThan(24 * 60);
  });
});

describe("regras-modelo: validar as regras", () => {
  const valid = {
    id: "r1",
    match: { requester: "claude", purpose: "action", action: "deploy-*", tags: ["staging"] },
    decision: "ask",
    once: "session",
    window: { days: ["mon", "fri"], from: "08:00", to: "18:00" },
    outsideWindow: "deny",
    maxPerHour: 5,
    maxPerDay: 20,
    expiresAt: NOW + HOUR,
  };

  test("regras bem formadas passam como estão, e uma lista vazia também", () => {
    expect(validateRules([valid])).toEqual({ rules: [valid] as unknown as Rule[], errors: [] });
    expect(validateRules([]).rules).toEqual([]);
    const minimal = { id: "m", decision: "deny" };
    expect(validateRules([minimal]).rules).toEqual([
      { id: "m", match: {}, decision: "deny" },
    ] as Rule[]);
  });

  test("o que não é uma lista de regras, ou uma regra malformada, é erro com o caminho e o código", () => {
    const errorsOf = (raw: unknown) =>
      validateRules(raw)
        .errors.map((e) => `${e.path}:${e.code}`)
        .join(" | ");
    expect(errorsOf("regra")).toBe(":not_list");
    expect(errorsOf([42])).toBe("0:not_object");
    expect(errorsOf([{ decision: "allow" }])).toBe("0.id:required");
    expect(errorsOf([{ id: "a", decision: "talvez" }])).toBe("0.decision:not_one_of");
    expect(errorsOf([{ id: "a", decision: "deny", extra: 1 }])).toBe("0.extra:unknown_field");
    expect(errorsOf([{ id: "a", decision: "deny", match: { quem: "x" } }])).toBe(
      "0.match.quem:unknown_field",
    );
    expect(errorsOf([{ id: "a", decision: "deny", match: { requester: "root" } }])).toBe(
      "0.match.requester:not_one_of",
    );
    expect(errorsOf([{ id: "a", decision: "deny", match: { purpose: "sudo" } }])).toBe(
      "0.match.purpose:not_one_of",
    );
    expect(errorsOf([{ id: "a", decision: "deny", match: { tags: "prod" } }])).toBe(
      "0.match.tags:not_list_of_text",
    );
    expect(errorsOf([{ id: "a", decision: "deny", match: { host: 3 } }])).toBe(
      "0.match.host:not_text",
    );
    expect(errorsOf([{ id: "a", decision: "deny", match: "tudo" }])).toBe("0.match:not_object");
    expect(
      errorsOf([
        { id: "a", decision: "deny" },
        { id: "a", decision: "deny" },
      ]),
    ).toBe("1.id:duplicate");
  });

  test("a code that lists the accepted values carries them as a param", () => {
    expect(validateRules([{ id: "a", decision: "talvez" }]).errors).toEqual([
      { path: "0.decision", code: "not_one_of", params: { allowed: "allow, ask, deny" } },
    ]);
    expect(
      validateRules([
        { id: "a", decision: "ask", window: { days: ["x"], from: "08:00", to: "18:00" } },
      ]).errors[0],
    ).toEqual({
      path: "0.window.days",
      code: "not_one_of",
      params: { allowed: "mon, tue, wed, thu, fri, sat, sun" },
    });
    expect(
      validateRules([
        { id: "a", decision: "ask", window: { days: ["mon"], from: "08:00", to: "25:00" } },
      ]).errors[0],
    ).toEqual({ path: "0.window.to", code: "bad_time", params: { last: "24:00" } });
  });

  test("once só com ask; janela com dias, horas e from diferente de to; limites inteiros positivos", () => {
    const errorsOf = (over: Record<string, unknown>) =>
      validateRules([{ id: "a", decision: "ask", ...over }])
        .errors.map((e) => `${e.path}:${e.code}`)
        .join(" | ");
    expect(errorsOf({ decision: "allow", once: "session" })).toBe("0.once:once_needs_ask");
    expect(errorsOf({ once: "sempre" })).toBe("0.once:once_needs_ask");
    expect(errorsOf({ window: { days: ["mon"], from: "8h", to: "18:00" } })).toBe(
      "0.window.from:bad_time",
    );
    expect(errorsOf({ window: { days: ["mon"], from: "08:00", to: "25:00" } })).toBe(
      "0.window.to:bad_time",
    );
    expect(errorsOf({ window: { days: ["mon"], from: "08:00", to: "08:00" } })).toBe(
      "0.window.to:same_time",
    );
    expect(errorsOf({ window: { days: ["segunda"], from: "08:00", to: "18:00" } })).toBe(
      "0.window.days:not_one_of",
    );
    expect(errorsOf({ window: { days: [], from: "08:00", to: "18:00" } })).toBe(
      "0.window.days:not_one_of",
    );
    expect(errorsOf({ window: "dia útil" })).toBe("0.window:not_object");
    expect(errorsOf({ outsideWindow: "deny" })).toBe("0.outsideWindow:outside_needs_window");
    expect(
      errorsOf({ outsideWindow: "x", window: { days: ["mon"], from: "08:00", to: "24:00" } }),
    ).toBe("0.outsideWindow:not_one_of");
    expect(errorsOf({ maxPerHour: 0 })).toBe("0.maxPerHour:not_positive_int");
    expect(errorsOf({ maxPerDay: 1.5 })).toBe("0.maxPerDay:not_positive_int");
    expect(errorsOf({ expiresAt: "hoje" })).toBe("0.expiresAt:not_timestamp");
    expect(
      errorsOf({ window: { days: ["mon"], from: "08:00", to: "24:00" }, outsideWindow: "ask" }),
    ).toBe("");
  });

  test("o teto: run_with_secret nunca é liberado, e allow numa tag prod pede janela e não vale fora dela", () => {
    const errorsOf = (rule: Record<string, unknown>) =>
      validateRules([{ id: "a", ...rule }])
        .errors.map((e) => `${e.path}:${e.code}`)
        .join(" | ");
    expect(errorsOf({ decision: "allow", match: { purpose: "run_with_secret" } })).toBe(
      "0.decision:no_allow_run_with_secret",
    );
    expect(
      errorsOf({
        decision: "ask",
        outsideWindow: "allow",
        window: { days: ["mon"], from: "08:00", to: "18:00" },
        match: { purpose: "run_with_secret" },
      }),
    ).toBe("0.outsideWindow:no_allow_run_with_secret");
    expect(errorsOf({ decision: "allow", match: { tags: ["prod"] } })).toBe(
      "0.window:prod_needs_window",
    );
    expect(
      errorsOf({
        decision: "ask",
        outsideWindow: "allow",
        window: { days: ["mon"], from: "08:00", to: "18:00" },
        match: { tags: ["prod"] },
      }),
    ).toBe("0.outsideWindow:prod_needs_window");
  });

  test("com erro em alguma regra, nenhuma é devolvida como válida", () => {
    const out = validateRules([valid, { id: "ruim", decision: "x" }]);
    expect(out.errors.length).toBeGreaterThan(0);
    expect(out.rules).toEqual([]);
  });
});
