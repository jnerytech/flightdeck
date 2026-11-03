import { describe, expect, test } from "bun:test";
import {
  accountInfo,
  authStatus,
  type IdleQuery,
  normalizePlan,
  usageReport,
  withIdleQuery,
} from "../src/account/readers.ts";
import { FlightdeckError } from "../src/errors.ts";
import type { Exec } from "../src/exec.ts";

const SIGNED_IN = {
  loggedIn: true,
  authMethod: "claude.ai",
  apiProvider: "firstParty",
  analyticsDisabled: false,
  email: "demo@example.com",
  orgId: "org-1",
  orgName: "Demo Org",
  subscriptionType: "max",
};

const exec =
  (code: number, stdout: string): Exec =>
  async () => ({ code, stdout });

async function reason(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return error instanceof FlightdeckError ? error.reason : `not a FlightdeckError: ${error}`;
  }
  return undefined;
}

describe("conta-leitores: authStatus (claude auth status --json)", () => {
  test("a signed-in answer is read into the account fields", async () => {
    const got = await authStatus({
      claudePath: "/bin/claude",
      exec: exec(0, JSON.stringify(SIGNED_IN)),
    });
    expect(got).toEqual({
      loggedIn: true,
      authMethod: "claude.ai",
      apiProvider: "firstParty",
      email: "demo@example.com",
      organization: "Demo Org",
      plan: "max",
    });
  });

  test("a signed-out answer is read although the command exits 1", async () => {
    const out = JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty" });
    const got = await authStatus({ claudePath: "/bin/claude", exec: exec(1, out) });
    expect(got?.loggedIn).toBe(false);
    expect(got?.authMethod).toBe("none");
    expect(got?.email).toBeNull();
    expect(got?.plan).toBeNull();
  });

  test("a missing key is null and an unknown extra key is ignored", async () => {
    const got = await authStatus({
      claudePath: "/bin/claude",
      exec: exec(0, JSON.stringify({ loggedIn: true, somethingNew: { a: 1 } })),
    });
    expect(got).toEqual({
      loggedIn: true,
      authMethod: null,
      apiProvider: null,
      email: null,
      organization: null,
      plan: null,
    });
  });

  test("output that is not a JSON object reads as null", async () => {
    for (const out of ["", "not json", "[]", "null", "42"]) {
      expect(await authStatus({ claudePath: "/bin/claude", exec: exec(0, out) })).toBeNull();
    }
  });

  test("a wrongly typed key reads as null", async () => {
    const got = await authStatus({
      claudePath: "/bin/claude",
      exec: exec(0, JSON.stringify({ loggedIn: "yes", email: 3, subscriptionType: {} })),
    });
    expect(got?.loggedIn).toBeNull();
    expect(got?.email).toBeNull();
    expect(got?.plan).toBeNull();
  });

  test("with no claude to run there is nothing to read", async () => {
    let ran = false;
    const got = await authStatus({
      claudePath: null,
      exec: async () => {
        ran = true;
        return { code: 0, stdout: "{}" };
      },
    });
    expect(got).toBeNull();
    expect(ran).toBe(false);
  });

  test("the command is `<claude> auth status --json`", async () => {
    let seen: string[] = [];
    await authStatus({
      claudePath: "/bin/claude",
      exec: async (cmd) => {
        seen = cmd;
        return { code: 0, stdout: "{}" };
      },
    });
    expect(seen).toEqual(["/bin/claude", "auth", "status", "--json"]);
  });

  test("a command that fails to run is account_unavailable", async () => {
    const failing: Exec = async () => {
      throw new Error("spawn ENOENT");
    };
    expect(await reason(() => authStatus({ claudePath: "/bin/claude", exec: failing }))).toBe(
      "account_unavailable",
    );
  });

  test("a command that hangs past the timeout is account_unavailable", async () => {
    const hanging: Exec = () => new Promise(() => {});
    expect(
      await reason(() => authStatus({ claudePath: "/bin/claude", exec: hanging, timeoutMs: 20 })),
    ).toBe("account_unavailable");
  });
});

describe("conta-leitores: normalizePlan", () => {
  test('"Claude Max", "max" and " MAX " are one value', () => {
    expect(normalizePlan("Claude Max")).toBe("max");
    expect(normalizePlan("max")).toBe("max");
    expect(normalizePlan(" MAX ")).toBe("max");
  });

  test("the other plans keep their name", () => {
    expect(normalizePlan("Claude Pro")).toBe("pro");
    expect(normalizePlan("team")).toBe("team");
    expect(normalizePlan("Claude Enterprise")).toBe("enterprise");
    expect(normalizePlan("free")).toBe("free");
    expect(normalizePlan("Claude Weird Plan")).toBe("weird plan");
  });

  test("nothing usable is null", () => {
    expect(normalizePlan(undefined)).toBeNull();
    expect(normalizePlan(null)).toBeNull();
    expect(normalizePlan("")).toBeNull();
    expect(normalizePlan("   ")).toBeNull();
    expect(normalizePlan(5)).toBeNull();
  });
});

describe("conta-leitores: accountInfo (SDK)", () => {
  test("the SDK shape is read, with the plan normalized", async () => {
    const query: IdleQuery = {
      accountInfo: async () => ({
        email: "demo@example.com",
        organization: "Demo Org",
        subscriptionType: "Claude Max",
        tokenSource: "claude.ai",
        apiProvider: "firstParty",
        somethingNew: true,
      }),
    };
    expect(await accountInfo(query)).toEqual({
      email: "demo@example.com",
      organization: "Demo Org",
      plan: "max",
      tokenSource: "claude.ai",
      apiKeySource: null,
      apiProvider: "firstParty",
    });
  });

  test("a signed-out answer has no email and a none token source", async () => {
    const query: IdleQuery = {
      accountInfo: async () => ({ tokenSource: "none", apiProvider: "firstParty" }),
    };
    const got = await accountInfo(query);
    expect(got?.email).toBeNull();
    expect(got?.tokenSource).toBe("none");
  });

  test("a query without the call, or an answer that is not an object, reads as null", async () => {
    expect(await accountInfo({})).toBeNull();
    expect(await accountInfo({ accountInfo: async () => "nope" })).toBeNull();
    expect(await accountInfo({ accountInfo: async () => null })).toBeNull();
  });

  test("a thrown error and a hang are account_unavailable", async () => {
    const thrown: IdleQuery = {
      accountInfo: async () => {
        throw new Error("boom");
      },
    };
    expect(await reason(() => accountInfo(thrown))).toBe("account_unavailable");
    const hung: IdleQuery = { accountInfo: () => new Promise(() => {}) };
    expect(await reason(() => accountInfo(hung, 20))).toBe("account_unavailable");
  });
});

describe("conta-leitores: usageReport (SDK)", () => {
  const report = {
    subscription_type: "max",
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 56, resets_at: "2026-11-03T20:40:00.405640+00:00" },
      seven_day: { utilization: 53, resets_at: "2026-11-07T23:00:00.405661+00:00" },
      seven_day_opus: null,
      seven_day_sonnet: { utilization: 10, resets_at: null },
      seven_day_oauth_apps: null,
      seven_day_breakdown: {},
      tangelo: { utilization: 99, resets_at: "2026-11-04T00:00:00+00:00" },
    },
  };
  const asQuery = (value: unknown): IdleQuery => ({
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => value,
  });

  test("windows become 0 to 1 fractions with the reset in milliseconds; unknown keys are ignored", async () => {
    const got = await usageReport(asQuery(report));
    expect(got.plan).toBe("max");
    expect(got.available).toBe(true);
    expect(got.windows).toEqual([
      {
        window: "five_hour",
        utilization: 0.56,
        status: "allowed",
        resetsAt: Date.parse("2026-11-03T20:40:00.405640+00:00"),
      },
      {
        window: "seven_day",
        utilization: 0.53,
        status: "allowed",
        resetsAt: Date.parse("2026-11-07T23:00:00.405661+00:00"),
      },
      { window: "seven_day_sonnet", utilization: 0.1, status: "allowed", resetsAt: null },
    ]);
  });

  test("a window at 80% or more warns and at 100% is rejected", async () => {
    const got = await usageReport(
      asQuery({
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 80, resets_at: null },
          seven_day: { utilization: 100, resets_at: null },
        },
      }),
    );
    expect(got.windows.map((w) => w.status)).toEqual(["allowed_warning", "rejected"]);
  });

  test("rate_limits null or rate_limits_available false is no windows", async () => {
    const off = await usageReport(
      asQuery({ subscription_type: null, rate_limits_available: false, rate_limits: null }),
    );
    expect(off).toEqual({ plan: null, available: false, windows: [] });
    const hidden = await usageReport(asQuery({ ...report, rate_limits_available: false }));
    expect(hidden.available).toBe(false);
    expect(hidden.windows).toEqual([]);
  });

  test("a window with a null or non-numeric utilization, or a bad date, is read defensively", async () => {
    const got = await usageReport(
      asQuery({
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: null, resets_at: null },
          seven_day: { utilization: "7", resets_at: null },
          seven_day_opus: { utilization: 5, resets_at: "not a date" },
        },
      }),
    );
    expect(got.windows).toEqual([
      { window: "seven_day_opus", utilization: 0.05, status: "allowed", resetsAt: null },
    ]);
  });

  test("an unusable answer, or a query without the call, is no windows", async () => {
    const none = { plan: null, available: false, windows: [] };
    expect(await usageReport(asQuery("x"))).toEqual(none);
    expect(await usageReport(asQuery(null))).toEqual(none);
    expect(await usageReport({})).toEqual(none);
  });

  test("a thrown error and a hang are account_unavailable", async () => {
    const thrown: IdleQuery = {
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
        throw new Error("changed");
      },
    };
    expect(await reason(() => usageReport(thrown))).toBe("account_unavailable");
    const hung: IdleQuery = {
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () => new Promise(() => {}),
    };
    expect(await reason(() => usageReport(hung, 20))).toBe("account_unavailable");
  });

  test("the call asks for the report without behaviors", async () => {
    let seen: unknown;
    await usageReport({
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async (opts) => {
        seen = opts;
        return null;
      },
    });
    expect(seen).toEqual({ skipBehaviors: true });
  });
});

describe("conta-leitores: withIdleQuery", () => {
  test("opens a query that never receives a prompt, runs the reader and closes it", async () => {
    const calls: Array<Record<string, unknown>> = [];
    let closed = 0;
    const deps = {
      claudePath: "/bin/claude",
      query: (params: { prompt: AsyncIterable<never>; options: Record<string, unknown> }) => {
        calls.push(params.options);
        return { close: () => void closed++ };
      },
    };
    const out = await withIdleQuery(deps, async () => "done");
    expect(out).toBe("done");
    expect(closed).toBe(1);
    expect(calls[0]).toMatchObject({
      settingSources: [],
      persistSession: false,
      pathToClaudeCodeExecutable: "/bin/claude",
    });
  });

  test("closes the query even when the reader throws, and leaves out a path it does not have", async () => {
    let closed = 0;
    let options: Record<string, unknown> = {};
    const deps = {
      claudePath: null,
      query: (params: { prompt: AsyncIterable<never>; options: Record<string, unknown> }) => {
        options = params.options;
        return { close: () => void closed++ };
      },
    };
    await expect(
      withIdleQuery(deps, async () => {
        throw new Error("read failed");
      }),
    ).rejects.toThrow("read failed");
    expect(closed).toBe(1);
    expect("pathToClaudeCodeExecutable" in options).toBe(false);
  });
});
