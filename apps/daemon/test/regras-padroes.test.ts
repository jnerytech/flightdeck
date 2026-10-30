import { describe, expect, test } from "bun:test";
import { decideRequest, requesterOf } from "../src/vault/requests.ts";
import {
  type Day,
  evaluate,
  type Rule,
  type RulesEnv,
  type UseContext,
  validateRules,
} from "../src/vault/rules.ts";

/** Wednesday 2026-10-28, 12:00 in a UTC-3 PC. */
const NOW = Date.UTC(2026, 9, 28, 15, 0, 0);
const HOUR = 3_600_000;
const DAYS: Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function env(now = NOW): RulesEnv {
  return {
    now: () => now,
    local: (ms) => {
      const shifted = new Date(ms - 3 * HOUR);
      return {
        day: DAYS[shifted.getUTCDay()] as Day,
        minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
      };
    },
    uses: () => 0,
  };
}

const use = (over: Partial<UseContext> = {}): UseContext => ({
  secretId: "tok",
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

const OFFICE = { days: ["mon", "tue", "wed", "thu", "fri"] as Day[], from: "08:00", to: "18:00" };

describe("regras-padroes: o padrão sem regra", () => {
  test("uso por você no app: allow", () => {
    for (const purpose of ["ssh", "action", "run_with_secret"] as const) {
      expect(evaluate([], use({ requester: "you", purpose }), env())).toMatchObject({
        decision: "allow",
        ruleId: null,
        needsHold: false,
      });
    }
    // Not even prod or a high-risk command makes the owner ask himself.
    expect(
      evaluate([], use({ requester: "you", tags: ["prod"], risk: "high" }), env()),
    ).toMatchObject({ decision: "allow" });
  });

  test("claude com uma ação declarada: ask uma vez por sessão; o approval da ação ajusta", () => {
    expect(evaluate([], use(), env())).toMatchObject({
      decision: "ask",
      once: true,
      needsHold: false,
    });
    expect(evaluate([], use({ actionApproval: "first-per-session" }), env())).toMatchObject({
      decision: "ask",
      once: true,
    });
    expect(evaluate([], use({ actionApproval: "always" }), env())).toMatchObject({
      decision: "ask",
      once: false,
    });
    expect(evaluate([], use({ actionApproval: "never" }), env())).toMatchObject({
      decision: "allow",
    });
    // An ssh destination is asked like an action.
    expect(evaluate([], use({ purpose: "ssh" }), env())).toMatchObject({
      decision: "ask",
      once: true,
    });
  });

  test("claude com run_with_secret: ask a cada uso, qualquer que seja o approval", () => {
    for (const actionApproval of [undefined, "never", "first-per-session"] as const) {
      expect(
        evaluate(
          [],
          use({ purpose: "run_with_secret", ...(actionApproval ? { actionApproval } : {}) }),
          env(),
        ),
      ).toMatchObject({ decision: "ask", once: false });
    }
  });

  test("automation e workflow: deny", () => {
    for (const requester of ["automation", "workflow"] as const) {
      const verdict = evaluate([], use({ requester }), env());
      expect(verdict).toMatchObject({ decision: "deny", ruleId: null });
      expect(verdict.reason).toContain(requester);
    }
  });

  test("tag prod ou produção: ask a cada uso para quem não é você, com o botão segurado", () => {
    for (const tag of ["prod", "produção", "PROD"]) {
      expect(evaluate([], use({ tags: [tag] }), env())).toMatchObject({
        decision: "ask",
        once: false,
        needsHold: true,
      });
      // Even an action that says never is asked in prod.
      expect(evaluate([], use({ tags: [tag], actionApproval: "never" }), env())).toMatchObject({
        decision: "ask",
        once: false,
        needsHold: true,
      });
    }
    // The hold is for prod; an ordinary ask does not need it.
    expect(evaluate([], use({ tags: ["staging"] }), env()).needsHold).toBe(false);
  });
});

describe("regras-padroes: a regra afrouxa o padrão, até o teto", () => {
  test("uma regra allow deixa o Claude rodar o deploy-staging sem perguntar", () => {
    const rules = [
      rule({ id: "staging", match: { requester: "claude", action: "deploy-staging" } }),
    ];
    expect(evaluate(rules, use(), env())).toMatchObject({
      decision: "allow",
      ruleId: "staging",
      needsHold: false,
    });
  });

  test("uma regra pode liberar a automação, e uma ask pode ser uma vez por sessão", () => {
    expect(
      evaluate(
        [rule({ id: "auto", match: { requester: "automation" } })],
        use({ requester: "automation" }),
        env(),
      ),
    ).toMatchObject({ decision: "allow", ruleId: "auto" });
    expect(
      evaluate(
        [rule({ id: "sessao", decision: "ask", once: "session" })],
        use({ actionApproval: "always" }),
        env(),
      ),
    ).toMatchObject({ decision: "ask", once: true, ruleId: "sessao" });
    expect(evaluate([rule({ id: "sempre", decision: "ask" })], use(), env())).toMatchObject({
      decision: "ask",
      once: false,
    });
  });

  test("allow para run_with_secret nunca vale: vira ask a cada uso, mesmo que a regra não diga a finalidade", () => {
    const everything = [rule({ id: "tudo" })];
    const verdict = evaluate(everything, use({ purpose: "run_with_secret" }), env());
    expect(verdict).toMatchObject({ decision: "ask", once: false, ruleId: "tudo" });
    expect(verdict.reason).toContain("run_with_secret");
    // Not even a once: session rule makes run_with_secret ask only once.
    expect(
      evaluate(
        [rule({ id: "uma", decision: "ask", once: "session" })],
        use({ purpose: "run_with_secret" }),
        env(),
      ),
    ).toMatchObject({ decision: "ask", once: false });
    // A deny stays a deny.
    expect(
      evaluate([rule({ id: "n", decision: "deny" })], use({ purpose: "run_with_secret" }), env()),
    ).toMatchObject({ decision: "deny" });
  });

  test("allow para prod sem janela nunca vale: vira ask a cada uso", () => {
    const verdict = evaluate([rule({ id: "livre" })], use({ tags: ["prod"] }), env());
    expect(verdict).toMatchObject({
      decision: "ask",
      once: false,
      needsHold: true,
      ruleId: "livre",
    });
    expect(verdict.reason).toContain("prod");
  });

  test("allow para prod com janela vale dentro dela; fora vale o outsideWindow (deny)", () => {
    const rules = [rule({ id: "util", match: { tags: ["prod"] }, window: OFFICE })];
    expect(evaluate(rules, use({ tags: ["prod"] }), env())).toMatchObject({
      decision: "allow",
      needsHold: false,
    });
    expect(evaluate(rules, use({ tags: ["prod"] }), env(NOW + 8 * HOUR))).toMatchObject({
      decision: "deny",
    });
  });

  test("o outsideWindow que seria allow também não passa o teto em prod", () => {
    const rules = [rule({ id: "r", decision: "ask", window: OFFICE, outsideWindow: "allow" })];
    expect(evaluate(rules, use({ tags: ["prod"] }), env(NOW + 8 * HOUR))).toMatchObject({
      decision: "ask",
      once: false,
      needsHold: true,
    });
  });

  test("o uso por você não sofre o teto, e uma regra deny para você vale", () => {
    expect(
      evaluate([rule({ id: "livre" })], use({ requester: "you", tags: ["prod"] }), env()),
    ).toMatchObject({ decision: "allow" });
    expect(
      evaluate(
        [rule({ id: "n", match: { requester: "you" }, decision: "deny" })],
        use({ requester: "you" }),
        env(),
      ),
    ).toMatchObject({ decision: "deny", ruleId: "n" });
  });
});

describe("regras-padroes: o risco alto sobe para ask", () => {
  test("allow com risco high vira ask a cada uso, com o botão segurado", () => {
    const verdict = evaluate([rule({ id: "livre" })], use({ risk: "high" }), env());
    expect(verdict).toMatchObject({ decision: "ask", once: false, needsHold: true });
    expect(verdict.reason).toContain("risco alto");
  });

  test("ask uma vez por sessão com risco high vira a cada uso; deny continua deny; medium e low não mudam", () => {
    expect(
      evaluate([rule({ id: "s", decision: "ask", once: "session" })], use({ risk: "high" }), env()),
    ).toMatchObject({ decision: "ask", once: false, needsHold: true });
    expect(
      evaluate([rule({ id: "n", decision: "deny" })], use({ risk: "high" }), env()),
    ).toMatchObject({ decision: "deny", needsHold: false });
    for (const risk of ["low", "medium"] as const) {
      expect(evaluate([rule({ id: "livre" })], use({ risk }), env())).toMatchObject({
        decision: "allow",
        needsHold: false,
      });
    }
  });
});

describe("regras-padroes: o app recusa salvar o que passa do teto", () => {
  const errorsOf = (rules: unknown[]) => validateRules(rules).errors.join(" | ");

  test("allow para run_with_secret é recusado, com o motivo", () => {
    const errors = errorsOf([
      { id: "r", decision: "allow", match: { purpose: "run_with_secret" } },
    ]);
    expect(errors).toContain("run_with_secret");
    expect(errors).toContain("aprovação");
    expect(
      errorsOf([
        {
          id: "r",
          decision: "ask",
          match: { purpose: "run_with_secret" },
          window: OFFICE,
          outsideWindow: "allow",
        },
      ]),
    ).toContain("run_with_secret");
    // ask and deny are fine for it.
    expect(errorsOf([{ id: "a", decision: "ask", match: { purpose: "run_with_secret" } }])).toBe(
      "",
    );
    expect(errorsOf([{ id: "d", decision: "deny", match: { purpose: "run_with_secret" } }])).toBe(
      "",
    );
  });

  test("allow para prod sem janela é recusado; com janela passa; prod e produção valem", () => {
    for (const tag of ["prod", "produção", "Prod"]) {
      const errors = errorsOf([{ id: "r", decision: "allow", match: { tags: [tag] } }]);
      expect(errors).toContain("prod");
      expect(errors).toContain("janela");
      expect(
        errorsOf([{ id: "w", decision: "allow", match: { tags: [tag] }, window: OFFICE }]),
      ).toBe("");
    }
    expect(errorsOf([{ id: "a", decision: "ask", match: { tags: ["prod"] } }])).toBe("");
    expect(errorsOf([{ id: "s", decision: "allow", match: { tags: ["staging"] } }])).toBe("");
  });
});

describe("regras-padroes: decideRequest", () => {
  const input = (over: Record<string, unknown> = {}) =>
    ({ ...use(), ...over }) as Parameters<typeof decideRequest>[0];

  test("o solicitante desconhecido, ou you vindo do daemon, é negado antes de qualquer regra", () => {
    for (const requester of ["you", "root", undefined, 3]) {
      const decision = decideRequest(input({ requester }), [rule({ id: "livre" })], env());
      expect(decision).toMatchObject({ granted: false, requester: "unknown", ruleId: null });
      expect(decision.reason).toContain("Claude");
    }
    expect(requesterOf("claude")).toBe("claude");
  });

  test("um solicitante conhecido passa pelas regras: o padrão pergunta, uma regra libera, outra nega", () => {
    expect(decideRequest(input(), [], env())).toMatchObject({
      granted: true,
      requester: "claude",
      decision: "ask",
      once: true,
      ruleId: null,
    });
    expect(decideRequest(input(), [rule({ id: "liberar" })], env())).toMatchObject({
      granted: true,
      decision: "allow",
      ruleId: "liberar",
    });
    const denied = decideRequest(
      input({ requester: "automation" }),
      [rule({ id: "nada", decision: "deny" })],
      env(),
    );
    expect(denied).toMatchObject({
      granted: false,
      requester: "automation",
      decision: "deny",
      ruleId: "nada",
    });
  });

  test("sem regras nem ambiente ele usa o padrão e o relógio do sistema", () => {
    expect(decideRequest(input({ requester: "workflow" }))).toMatchObject({
      granted: false,
      decision: "deny",
    });
    expect(decideRequest(input())).toMatchObject({ granted: true, decision: "ask" });
  });

  test("o pedido do run_with_secret, do prod e do risco alto sobem como no evaluate", () => {
    expect(
      decideRequest(input({ purpose: "run_with_secret" }), [rule({ id: "livre" })], env()),
    ).toMatchObject({ granted: true, decision: "ask", once: false });
    expect(decideRequest(input({ tags: ["prod"] }), [rule({ id: "livre" })], env())).toMatchObject({
      granted: true,
      decision: "ask",
      needsHold: true,
    });
    expect(decideRequest(input({ risk: "high" }), [rule({ id: "livre" })], env())).toMatchObject({
      granted: true,
      decision: "ask",
      needsHold: true,
    });
  });
});
