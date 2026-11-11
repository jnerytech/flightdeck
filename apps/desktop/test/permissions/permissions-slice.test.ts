import { describe, expect, test } from "bun:test";
import { PermissionsSlice } from "../../src/features/permissions/index.ts";
import { translator } from "../../src/i18n/index.ts";
import type { PendingItem } from "../../src/lib/app-store.ts";

const t = translator("en");

/** A slice over stand-ins: what went to the hosts, to the vault and to the banner. */
function permissions(
  over: {
    queued?: Array<Partial<PendingItem>>;
    items?: Record<string, Array<{ kind: string; requestId: string; risk?: string }>>;
    vault?: string[];
    selected?: string;
    fails?: boolean;
  } = {},
) {
  const log: unknown[] = [];
  const slice = new PermissionsSlice({
    needsYou: () => (over.queued ?? []) as PendingItem[],
    sessions: () =>
      Object.fromEntries(
        Object.entries(over.items ?? {}).map(([key, items]) => [key, { items }]),
      ) as never,
    selectedHostId: () => over.selected,
    settleVault: (requestId, answer) => {
      const mine = (over.vault ?? []).includes(requestId);
      if (mine) log.push({ vault: [requestId, answer] });
      return mine;
    },
    sendOn: (hostId, response) => {
      log.push({ on: hostId, response });
      return over.fails ? Promise.reject(new Error("offline")) : Promise.resolve();
    },
    sendSelected: async (response) => void log.push({ selected: response }),
    fail: (error, text) =>
      void log.push({ fail: error instanceof Error ? error.message : String(error), text }),
    t: () => t,
  });
  return { slice, log };
}

const high = { hostId: "h1", requestId: "r1", risk: "high" } as const;

describe("answering permission requests (#1596)", () => {
  test("an allow or a deny goes to the host with only what the person gave", async () => {
    const { slice, log } = permissions();
    await slice.respondTo("h1", "r1", "allow", { message: "because", updatedInput: { a: 1 } });
    await slice.respondTo("h1", "r2", "deny", { message: "no" });
    expect(log).toEqual([
      {
        on: "h1",
        response: {
          requestId: "r1",
          decision: "allow",
          message: "because",
          updatedInput: { a: 1 },
        },
      },
      { on: "h1", response: { requestId: "r2", decision: "deny", message: "no" } },
    ]);
  });

  test("held rides on an allow only", async () => {
    const { slice, log } = permissions();
    await slice.respondTo("h1", "r1", "allow", { held: true });
    await slice.respondTo("h1", "r2", "deny", { held: true });
    expect(log).toEqual([
      { on: "h1", response: { requestId: "r1", decision: "allow", held: true } },
      { on: "h1", response: { requestId: "r2", decision: "deny" } },
    ]);
  });

  test("an allow of a high-risk request that was not held is refused, and the person is told why", async () => {
    const { slice, log } = permissions({ queued: [high] });
    await slice.respondTo("h1", "r1", "allow");
    expect(log).toEqual([{ fail: t("approval.holdRequired"), text: t("approval.holdRequired") }]);
  });

  test("a held allow of a high-risk request goes through, and a deny never needs the hold", async () => {
    const { slice, log } = permissions({ queued: [high] });
    await slice.respondTo("h1", "r1", "allow", { held: true });
    await slice.respondTo("h1", "r1", "deny");
    expect(log).toEqual([
      { on: "h1", response: { requestId: "r1", decision: "allow", held: true } },
      { on: "h1", response: { requestId: "r1", decision: "deny" } },
    ]);
  });

  test("the risk is read from the session's own item when the queue does not list the request", async () => {
    const { slice, log } = permissions({
      items: {
        "h1/s1": [{ kind: "permission", requestId: "r1", risk: "high" }],
        "h2/s9": [{ kind: "permission", requestId: "r1", risk: "low" }],
      },
    });
    await slice.respondTo("h1", "r1", "allow");
    await slice.respondTo("h2", "r1", "allow");
    expect(log).toEqual([
      { fail: t("approval.holdRequired"), text: t("approval.holdRequired") },
      { on: "h2", response: { requestId: "r1", decision: "allow" } },
    ]);
  });

  test("a request of the vault is answered in the vault's queue, never sent to the host", async () => {
    const { slice, log } = permissions({ vault: ["v1"] });
    await slice.respondTo("h1", "v1", "allow");
    await slice.respondTo("h1", "v1", "deny");
    expect(log).toEqual([
      { vault: ["v1", { scope: "once", via: "app" }] },
      { vault: ["v1", null] },
    ]);
  });

  test("a host that refuses or drops the answer goes to the banner", async () => {
    const { slice, log } = permissions({ fails: true });
    await slice.respondTo("h1", "r1", "deny");
    expect(log.at(-1)).toEqual({ fail: "offline", text: undefined });
  });

  test("the open session's answer checks the hold on its host and goes to its session", async () => {
    const { slice, log } = permissions({ queued: [high], selected: "h1" });
    await slice.respond("r1", "allow");
    await slice.respond("r1", "allow", { held: true });
    expect(log).toEqual([
      { fail: t("approval.holdRequired"), text: t("approval.holdRequired") },
      { selected: { requestId: "r1", decision: "allow", held: true } },
    ]);
  });

  test("with no session open the answer is sent without a risk check", async () => {
    const { slice, log } = permissions({ queued: [high] });
    await slice.respond("r1", "allow");
    expect(log).toEqual([{ selected: { requestId: "r1", decision: "allow" } }]);
  });
});
