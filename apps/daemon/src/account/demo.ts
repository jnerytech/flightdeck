import type { AccountReaders } from "./account.ts";

/** The account the fake runtime (`--runtime fake`, the demo) answers: fixed, and nobody's. */
export function demoAccountReaders(now: () => number = Date.now): AccountReaders {
  return {
    status: async () => ({
      loggedIn: true,
      authMethod: "claude.ai",
      apiProvider: "firstParty",
      email: "demo@example.com",
      organization: "Demo Org",
      plan: "max",
    }),
    sdk: async () => ({
      info: null,
      usage: {
        plan: "max",
        available: true,
        windows: [
          {
            window: "five_hour",
            utilization: 0.42,
            status: "allowed",
            resetsAt: now() + 3 * 3_600_000,
          },
          {
            window: "seven_day",
            utilization: 0.18,
            status: "allowed",
            resetsAt: now() + 4 * 86_400_000,
          },
        ],
      },
    }),
  };
}
