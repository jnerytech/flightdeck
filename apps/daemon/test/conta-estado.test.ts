import { describe, expect, test } from "bun:test";
import { Account, type AccountReaders } from "../src/account/account.ts";
import type { AccountInfoReading, AuthStatus, UsageReading } from "../src/account/readers.ts";
import { FlightdeckError } from "../src/errors.ts";
import { Quota } from "../src/quota/quota.ts";

const T0 = Date.UTC(2026, 10, 3, 12, 0, 0);
const IN_2H = T0 + 2 * 3_600_000;
const IN_3D = T0 + 3 * 86_400_000;

const auth = (over: Partial<AuthStatus>): AuthStatus => ({
  loggedIn: true,
  authMethod: "claude.ai",
  apiProvider: "firstParty",
  email: "demo@example.com",
  organization: "Demo Org",
  plan: "max",
  ...over,
});

const info = (over: Partial<AccountInfoReading> = {}): AccountInfoReading => ({
  email: "demo@example.com",
  organization: "Demo Org",
  plan: "max",
  tokenSource: "claude.ai",
  apiKeySource: null,
  apiProvider: "firstParty",
  ...over,
});

const usage: UsageReading = {
  plan: "max",
  available: true,
  windows: [
    { window: "five_hour", utilization: 0.56, status: "allowed", resetsAt: IN_2H },
    { window: "seven_day", utilization: 0.53, status: "allowed", resetsAt: IN_3D },
  ],
};
const noUsage: UsageReading = { plan: null, available: false, windows: [] };

const unavailable = () => new FlightdeckError("invalid_state", "down", "account_unavailable");

function setup(readers: Partial<AccountReaders>) {
  let now = T0;
  const quota = new Quota({ pauseAt: null, now: () => now });
  const sdkCalls: number[] = [];
  const full: AccountReaders = {
    status: async () => auth({}),
    sdk: async () => {
      sdkCalls.push(1);
      return { info: info(), usage };
    },
    ...readers,
  };
  const account = new Account({ quota, readers: full, now: () => now });
  return {
    account,
    quota,
    sdkCalls,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("conta-estado: status for each fixture", () => {
  test("claude.ai sign-in is signed_in with name, organization, plan and provider", async () => {
    const { account } = setup({});
    const state = await account.readNow();
    expect(state.status).toBe("signed_in");
    expect(state.name).toBe("demo@example.com");
    expect(state.organization).toBe("Demo Org");
    expect(state.plan).toBe("max");
    expect(state.provider).toBe("firstParty");
    expect(state.source).toBe("sdk");
    expect(state.stale).toBe(false);
    expect(state.error).toBeNull();
    expect(state.readAt).toBe(new Date(T0).toISOString());
    expect(state.loginCommand).toBe("claude auth login");
  });

  test("loggedIn false is signed_out and the SDK is not asked", async () => {
    const { account, sdkCalls } = setup({
      status: async () =>
        auth({ loggedIn: false, authMethod: "none", email: null, organization: null, plan: null }),
    });
    const state = await account.readNow();
    expect(state.status).toBe("signed_out");
    expect(state.name).toBeNull();
    expect(state.windows).toEqual([]);
    expect(state.source).toBe("status");
    expect(sdkCalls).toEqual([]);
  });

  test("an API key and a gateway token are api_key, with no SDK call", async () => {
    for (const authMethod of ["api_key", "oauth_token"]) {
      const { account, sdkCalls } = setup({
        status: async () => auth({ authMethod, email: null, organization: null, plan: null }),
      });
      const state = await account.readNow();
      expect(state.status).toBe("api_key");
      expect(state.windows).toEqual([]);
      expect(sdkCalls).toEqual([]);
    }
  });

  test("a cloud provider is third_party and keeps its provider name", async () => {
    const { account, sdkCalls } = setup({
      status: async () =>
        auth({
          authMethod: "third_party",
          apiProvider: "bedrock",
          email: null,
          organization: null,
          plan: null,
        }),
    });
    const state = await account.readNow();
    expect(state.status).toBe("third_party");
    expect(state.provider).toBe("bedrock");
    expect(sdkCalls).toEqual([]);
  });

  test("an auth method nobody knows is unknown", async () => {
    const { account } = setup({ status: async () => auth({ authMethod: "from-the-future" }) });
    expect((await account.readNow()).status).toBe("unknown");
  });

  test("without a status (no claude path), the SDK decides: a none token is signed_out", async () => {
    const { account } = setup({
      status: async () => null,
      sdk: async () => ({
        info: info({ email: null, organization: null, plan: null, tokenSource: "none" }),
        usage: noUsage,
      }),
    });
    expect((await account.readNow()).status).toBe("signed_out");
  });

  test("without a status, an email is signed_in and an API key source is api_key", async () => {
    const withEmail = setup({ status: async () => null });
    expect((await withEmail.account.readNow()).status).toBe("signed_in");
    const withKey = setup({
      status: async () => null,
      sdk: async () => ({
        info: info({
          email: null,
          organization: null,
          plan: null,
          tokenSource: "none",
          apiKeySource: "ANTHROPIC_API_KEY",
        }),
        usage: noUsage,
      }),
    });
    expect((await withKey.account.readNow()).status).toBe("api_key");
  });

  test("without a status and with nothing from the SDK, the state is unknown", async () => {
    const { account } = setup({
      status: async () => null,
      sdk: async () => ({ info: null, usage: noUsage }),
    });
    expect((await account.readNow()).status).toBe("unknown");
  });

  test("a field the status lacks comes from the SDK, and the status wins when both have it", async () => {
    const { account } = setup({
      status: async () => auth({ organization: null, plan: null, email: "status@example.com" }),
      sdk: async () => ({
        info: info({ email: "sdk@example.com", organization: "From SDK", plan: "pro" }),
        usage: { ...usage, plan: "team" },
      }),
    });
    const state = await account.readNow();
    expect(state.name).toBe("status@example.com");
    expect(state.organization).toBe("From SDK");
    expect(state.plan).toBe("pro");
  });

  test("the plan falls back to the usage report's", async () => {
    const { account } = setup({
      status: async () => auth({ plan: null }),
      sdk: async () => ({ info: info({ plan: null }), usage }),
    });
    expect((await account.readNow()).plan).toBe("max");
  });

  test("before any read the state is unknown and empty", () => {
    const { account } = setup({});
    expect(account.state()).toEqual({
      status: "unknown",
      name: null,
      organization: null,
      plan: null,
      provider: null,
      windows: [],
      readAt: null,
      stale: false,
      error: null,
      source: "status",
      loginCommand: "claude auth login",
    });
  });
});

describe("conta-estado: the windows go through the quota", () => {
  test("they are recorded as 0 to 1 fractions with the ISO reset, and the state shows them", async () => {
    const { account, quota } = setup({});
    const state = await account.readNow();
    const five = quota.windows().find((w) => w.window === "five_hour");
    expect(five?.utilization).toBe(0.56);
    expect(five?.resetsAt).toBe(new Date(IN_2H).toISOString());
    expect(state.windows).toEqual(quota.windows());
    expect(state.windows.map((w) => w.window)).toEqual(["five_hour", "seven_day"]);
  });

  test("a window past its reset is dropped from the state", async () => {
    const { account, advance } = setup({});
    await account.readNow();
    advance(3 * 3_600_000);
    expect(account.state().windows.map((w) => w.window)).toEqual(["seven_day"]);
  });

  test("a host that is not signed in shows no windows even if the quota holds some", async () => {
    const { account, quota } = setup({
      status: async () => auth({ loggedIn: false, authMethod: "none" }),
    });
    quota.record([{ window: "five_hour", utilization: 0.4, status: "allowed", resetsAt: IN_2H }]);
    expect((await account.readNow()).windows).toEqual([]);
  });

  test("a usage report that fails keeps the account and leaves the windows as they were", async () => {
    let fail = false;
    const { account } = setup({
      sdk: async () => {
        if (fail) throw unavailable();
        return { info: info(), usage };
      },
    });
    await account.readNow();
    fail = true;
    const state = await account.readNow();
    expect(state.status).toBe("signed_in");
    expect(state.name).toBe("demo@example.com");
    expect(state.windows.length).toBe(2);
    expect(state.source).toBe("status");
    expect(state.stale).toBe(false);
    expect(state.error).toBeNull();
  });
});

describe("conta-estado: a failed read", () => {
  test("keeps the last state and flags it stale with the reason", async () => {
    let fail = false;
    const { account, advance } = setup({
      status: async () => {
        if (fail) throw unavailable();
        return auth({});
      },
    });
    const good = await account.readNow();
    fail = true;
    advance(60_000);
    const state = await account.readNow();
    expect(state).toEqual({
      ...good,
      windows: state.windows,
      stale: true,
      error: "account_unavailable",
    });
    expect(state.readAt).toBe(good.readAt);
    expect(state.status).toBe("signed_in");
    expect(state.name).toBe("demo@example.com");
  });

  test("a later good read clears the flag", async () => {
    let fail = false;
    const { account, advance } = setup({
      status: async () => {
        if (fail) throw unavailable();
        return auth({});
      },
    });
    await account.readNow();
    fail = true;
    await account.readNow();
    fail = false;
    advance(1_000);
    const state = await account.readNow();
    expect(state.stale).toBe(false);
    expect(state.error).toBeNull();
    expect(state.readAt).toBe(new Date(T0 + 1_000).toISOString());
  });

  test("with nothing read before, the state is unknown with the reason and no age", async () => {
    const { account } = setup({
      status: async () => {
        throw unavailable();
      },
    });
    const state = await account.readNow();
    expect(state.status).toBe("unknown");
    expect(state.error).toBe("account_unavailable");
    expect(state.readAt).toBeNull();
    expect(state.stale).toBe(false);
  });

  test("an error that is not a refusal is account_unavailable too", async () => {
    const { account } = setup({
      status: async () => {
        throw new Error("boom");
      },
    });
    expect((await account.readNow()).error).toBe("account_unavailable");
  });
});
