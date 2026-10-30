import { describe, expect, test } from "bun:test";
import {
  access,
  addressOf,
  DEFAULT_POLICY,
  type Exception,
  type History,
  limits,
  MAX_TEXT_BYTES,
  type Party,
  type Policy,
  sizeError,
  validatePolicy,
} from "../src/messaging/policy.ts";
import { setup } from "./mensagens-helpers.ts";

const NOW = Date.UTC(2026, 9, 28, 15, 0, 0);
const HOUR = 3_600_000;
const MINUTE = 60_000;

const party = (over: Partial<Party> = {}): Party => ({
  id: "s1",
  host: "pc",
  name: "uma",
  persona: null,
  projectKey: "github.com/acme/app",
  teamId: null,
  ...over,
});

const policy = (over: Partial<Policy> = {}): Policy => ({ ...DEFAULT_POLICY, ...over });

describe("mensagens-regras: quem pode falar com quem", () => {
  test("o endereço é host/id", () => {
    expect(addressOf({ host: "pc", id: "s1" })).toBe("pc/s1");
  });

  test("por padrão só o mesmo projeto, ou o mesmo time, e entre hosts o projeto vale pela chave", () => {
    const a = party();
    expect(access(a, party({ id: "s2", host: "wsl" }), policy())).toEqual({
      ok: true,
      via: "project",
    });
    const other = access(a, party({ id: "s2", projectKey: "github.com/acme/outro" }), policy());
    expect(other).toMatchObject({ ok: false });
    expect((other as { reason: string }).reason).toContain("projeto");
    // The same team talks across projects.
    expect(
      access(
        party({ teamId: "t1" }),
        party({ id: "s2", projectKey: "github.com/acme/outro", teamId: "t1" }),
        policy(),
      ),
    ).toEqual({ ok: true, via: "team" });
    // A project key that is missing never matches, not even another missing one.
    expect(
      access(party({ projectKey: null }), party({ id: "s2", projectKey: null }), policy()),
    ).toMatchObject({ ok: false });
    // A team that is missing never matches either.
    expect(
      access(
        party({ projectKey: null, teamId: null }),
        party({ id: "s2", projectKey: null, teamId: null }),
        policy(),
      ),
    ).toMatchObject({ ok: false });
  });

  test("uma sessão não manda para si mesma", () => {
    const result = access(party(), party(), policy());
    expect(result).toMatchObject({ ok: false });
    expect((result as { reason: string }).reason).toContain("si mesma");
  });

  test("uma exceção libera o par, num sentido ou nos dois, por sessão, projeto, time ou host", () => {
    const outsider = party({ id: "s9", host: "wsl", projectKey: "github.com/acme/outro" });
    const insider = party();
    const oneWay: Exception = {
      id: "e1",
      from: { session: "pc/s1" },
      to: { project: "github.com/acme/outro" },
    };
    expect(access(insider, outsider, policy({ exceptions: [oneWay] }))).toEqual({
      ok: true,
      via: "exception",
    });
    // The other way is not allowed by a one-way exception.
    expect(access(outsider, insider, policy({ exceptions: [oneWay] }))).toMatchObject({
      ok: false,
    });
    expect(
      access(outsider, insider, policy({ exceptions: [{ ...oneWay, bothWays: true }] })),
    ).toEqual({ ok: true, via: "exception" });
    const selectors: Exception[] = [
      { id: "a", from: { session: "s1" }, to: { session: "wsl/s9" } },
      { id: "b", from: { host: "pc" }, to: { host: "wsl" } },
      { id: "c", from: { team: "t1" }, to: { project: "github.com/acme/outro" } },
    ];
    expect(access(insider, outsider, policy({ exceptions: [selectors[0] as Exception] })).ok).toBe(
      true,
    );
    expect(access(insider, outsider, policy({ exceptions: [selectors[1] as Exception] })).ok).toBe(
      true,
    );
    expect(access(insider, outsider, policy({ exceptions: [selectors[2] as Exception] })).ok).toBe(
      false,
    );
    expect(
      access(party({ teamId: "t1" }), outsider, policy({ exceptions: [selectors[2] as Exception] }))
        .ok,
    ).toBe(true);
    // Every field of a selector has to match.
    expect(
      access(
        insider,
        outsider,
        policy({ exceptions: [{ id: "d", from: { host: "pc", team: "t9" }, to: {} }] }),
      ).ok,
    ).toBe(false);
  });
});

describe("mensagens-regras: tamanho", () => {
  test("até 32 KB passa; acima é recusada, contando bytes", () => {
    expect(MAX_TEXT_BYTES).toBe(32768);
    expect(sizeError("a".repeat(MAX_TEXT_BYTES))).toBeNull();
    expect(sizeError("a".repeat(MAX_TEXT_BYTES + 1))).toContain("32 KB");
    // 'é' takes two bytes: 16384 of them fit, one more does not.
    expect(sizeError("é".repeat(16384))).toBeNull();
    expect(sizeError("é".repeat(16385))).toContain("32 KB");
    expect(sizeError("")).toContain("vazia");
    expect(sizeError("   \n")).toContain("vazia");
  });
});

describe("mensagens-regras: limites", () => {
  /** A history where the pair sent `fromA` and `fromB` since any instant, and A sent `sent`. */
  const history = (
    over: { fromA?: number; fromB?: number; sent?: number } = {},
  ): History & { calls: Array<[string, number]> } => {
    const calls: Array<[string, number]> = [];
    return {
      calls,
      pair: (_a, _b, sinceMs) => {
        calls.push(["pair", sinceMs]);
        // Inside the last 10 minutes the pair is quiet unless told otherwise.
        return sinceMs >= NOW - 10 * MINUTE
          ? { fromA: 0, fromB: 0 }
          : { fromA: over.fromA ?? 0, fromB: over.fromB ?? 0 };
      },
      sent: (_address, sinceMs) => {
        calls.push(["sent", sinceMs]);
        return over.sent ?? 0;
      },
    };
  };

  test("20 por hora por par, contando os dois sentidos: a 21ª é recusada", () => {
    expect(limits("pc/s1", "pc/s2", history({ fromA: 10, fromB: 9 }), NOW, policy())).toEqual({
      ok: true,
    });
    const refused = limits("pc/s1", "pc/s2", history({ fromA: 10, fromB: 10 }), NOW, policy());
    expect(refused).toMatchObject({ ok: false, kind: "pair" });
    expect((refused as { reason: string }).reason).toContain("20 por hora");
    const h = history();
    limits("pc/s1", "pc/s2", h, NOW, policy());
    expect(h.calls).toContainEqual(["pair", NOW - HOUR]);
    expect(h.calls).toContainEqual(["sent", NOW - HOUR]);
  });

  test("100 por hora por sessão", () => {
    expect(limits("pc/s1", "pc/s2", history({ sent: 99 }), NOW, policy())).toEqual({ ok: true });
    const refused = limits("pc/s1", "pc/s2", history({ sent: 100 }), NOW, policy());
    expect(refused).toMatchObject({ ok: false, kind: "session" });
    expect((refused as { reason: string }).reason).toContain("100 por hora");
  });

  test("laço: mais de 10 mensagens em 10 minutos, indo e voltando, pausa o par", () => {
    const loopy = (fromA: number, fromB: number): History => ({
      pair: (_a, _b, since) =>
        since >= NOW - 10 * MINUTE ? { fromA, fromB } : { fromA: 0, fromB: 0 },
      sent: () => 0,
    });
    // 10 so far: the 11th makes more than 10.
    const looping = limits("pc/s1", "pc/s2", loopy(5, 5), NOW, policy());
    expect(looping).toMatchObject({ ok: false, kind: "loop" });
    expect((looping as { reason: string }).reason).toContain("laço");
    expect(limits("pc/s1", "pc/s2", loopy(5, 4), NOW, policy())).toEqual({ ok: true });
    // Ten in one direction only is a flood for the hourly limit, not a back and forth.
    expect(limits("pc/s1", "pc/s2", loopy(10, 0), NOW, policy())).toEqual({ ok: true });
    expect(limits("pc/s1", "pc/s2", loopy(0, 10), NOW, policy())).toEqual({ ok: true });
  });

  test("os números vêm da política", () => {
    const tight = policy({
      perPairPerHour: 2,
      perSessionPerHour: 3,
      loopMessages: 4,
      loopMinutes: 5,
    });
    expect(limits("a/1", "b/2", history({ fromA: 1, fromB: 1 }), NOW, tight)).toMatchObject({
      kind: "pair",
    });
    expect(limits("a/1", "b/2", history({ sent: 3 }), NOW, tight)).toMatchObject({
      kind: "session",
    });
    const h: History = {
      pair: (_a, _b, since) =>
        since >= NOW - 5 * MINUTE ? { fromA: 2, fromB: 2 } : { fromA: 0, fromB: 0 },
      sent: () => 0,
    };
    expect(limits("a/1", "b/2", h, NOW, tight)).toMatchObject({ kind: "loop" });
  });
});

describe("mensagens-regras: validar a política", () => {
  test("vazia vale o padrão; os campos entram; erros dizem o porquê", () => {
    expect(validatePolicy({})).toEqual({ policy: DEFAULT_POLICY, errors: [] });
    expect(validatePolicy(undefined).policy).toEqual(DEFAULT_POLICY);
    const good = validatePolicy({
      exceptions: [{ id: "e1", from: { host: "pc" }, to: { project: "p" }, bothWays: true }],
      perPairPerHour: 5,
      perSessionPerHour: 50,
      loopMessages: 6,
      loopMinutes: 3,
    });
    expect(good.errors).toEqual([]);
    expect(good.policy).toMatchObject({ perPairPerHour: 5, loopMinutes: 3 });
    expect(good.policy.exceptions).toHaveLength(1);
    const errorsOf = (raw: unknown) => validatePolicy(raw).errors.join(" | ");
    expect(errorsOf("regras")).toContain("objeto");
    expect(errorsOf({ perPairPerHour: 0 })).toContain("perPairPerHour");
    expect(errorsOf({ loopMinutes: 1.5 })).toContain("loopMinutes");
    expect(errorsOf({ exceptions: "tudo" })).toContain("exceptions");
    expect(errorsOf({ exceptions: [{ from: {}, to: {} }] })).toContain("id");
    expect(errorsOf({ exceptions: [{ id: "e", from: { quem: "x" }, to: {} }] })).toContain("quem");
    expect(errorsOf({ exceptions: [{ id: "e", from: {}, to: { host: 3 } }] })).toContain("host");
    expect(errorsOf({ exceptions: [{ id: "e", from: {} }] })).toContain("to");
    expect(
      errorsOf({
        exceptions: [
          { id: "e", from: {}, to: {} },
          { id: "e", from: {}, to: {} },
        ],
      }),
    ).toContain("repetido");
    expect(errorsOf({ extra: 1 })).toContain("extra");
    // With errors the default policy comes back, not half of the wrong one.
    expect(validatePolicy({ perPairPerHour: -1 }).policy).toEqual(DEFAULT_POLICY);
  });
});

describe("mensagens-regras: mais validações", () => {
  test("uma exceção que não é um objeto e um bothWays que não é verdadeiro ou falso são erros", () => {
    const errorsOf = (raw: unknown) => validatePolicy(raw).errors.join(" | ");
    expect(errorsOf({ exceptions: ["tudo"] })).toContain("objeto");
    expect(errorsOf({ exceptions: [{ id: "e", from: {}, to: {}, bothWays: "sim" }] })).toContain(
      "bothWays",
    );
  });
});

describe("mensagens-regras: retention rides in the policy", () => {
  test("retentionDays is 30 by default and a positive integer otherwise", () => {
    expect(validatePolicy({}).policy.retentionDays).toBe(30);
    expect(validatePolicy({ retentionDays: 7 })).toEqual({
      policy: { ...DEFAULT_POLICY, retentionDays: 7 },
      errors: [],
    });
    expect(validatePolicy({ retentionDays: 0 }).errors.join(" | ")).toContain("retentionDays");
  });

  test("a sweep keeps what the policy's retention still covers and drops the rest", () => {
    expect(validatePolicy({ retentionDays: 7 }).errors).toEqual([]);
    const { messaging, endpoints, now } = setup();
    endpoints.add("s1");
    endpoints.add("s2");
    messaging.setPolicy({ retentionDays: 7 });
    messaging.send({ as: { session: "s1" }, to: "s2", text: "velha" });
    now.at = NOW + 2 * 24 * HOUR;
    messaging.send({ as: { session: "s1" }, to: "s2", text: "nova" });
    now.at = NOW + 8 * 24 * HOUR;
    messaging.sweep();
    expect(messaging.list({ days: 365 }).map((m) => m.text)).toEqual(["nova"]);
  });
});
