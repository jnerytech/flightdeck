import { describe, expect, test } from "bun:test";
import { Account } from "../src/account/account.ts";
import { accountReaders } from "../src/account/readers.ts";
import { Quota } from "../src/quota/quota.ts";

const T0 = Date.UTC(2026, 10, 6, 12, 0, 0);

interface Plans {
  /** What `claude auth status --json` says (the plan stored at sign-in). */
  auth: string | null;
  /** The usage report's `subscription_type`. */
  usage: string | null;
  /** The SDK's `accountInfo()` answer, or `null` for none. */
  info: unknown;
}

// The three sources run through the real readers with a fake `claude` and a fake SDK query.
function account({ auth, usage, info }: Plans) {
  const readers = accountReaders({
    claudePath: "/bin/claude",
    exec: async () => ({
      code: 0,
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: "claude.ai",
        apiProvider: "firstParty",
        email: "demo@example.com",
        orgName: "Demo Org",
        ...(auth === null ? {} : { subscriptionType: auth }),
      }),
    }),
    query: () => ({
      accountInfo: async () => info,
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({
        ...(usage === null ? {} : { subscription_type: usage }),
        rate_limits_available: true,
        rate_limits: { five_hour: { utilization: 10, resets_at: null } },
      }),
      close: () => {},
    }),
  });
  const quota = new Quota({ pauseAt: null, now: () => T0 });
  return new Account({ quota, readers, now: () => T0 });
}

describe("account-plan: which plan the account card shows (#582)", () => {
  test("the SDK's live display name wins over the stale usage and sign-in plan", async () => {
    const live = account({
      auth: "max",
      usage: "max",
      info: { email: "demo@example.com", subscriptionType: "Claude Ultra" },
    });
    expect((await live.readNow()).plan).toBe("ultra");
  });

  test("without the SDK's account info the plan is the usage report's", async () => {
    const state = await account({ auth: "max", usage: "ultra", info: null }).readNow();
    expect(state.plan).toBe("ultra");
  });

  test("without the SDK's account info and a usage plan the plan is the sign-in's", async () => {
    const state = await account({ auth: "max", usage: null, info: null }).readNow();
    expect(state.plan).toBe("max");
  });
});
