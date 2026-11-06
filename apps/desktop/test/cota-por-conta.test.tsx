import { afterEach, describe, expect, test } from "bun:test";
import type { AccountState, QuotaState } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { waiter } from "./wait.ts";

registerDom();
const { cleanup, render, screen } = await import("@testing-library/react");
const { quotaGroups } = await import("../src/lib/quota.ts");
const { QuotaPanel } = await import("../src/ui/QuotaPanel.tsx");
const { translator } = await import("../src/i18n/index.ts");

afterEach(cleanup);
const settle = waiter(2000);

const account = (over: Partial<AccountState> = {}): AccountState => ({
  status: "signed_in",
  name: "ana@example.com",
  organization: "Acme",
  plan: "max",
  provider: "firstParty",
  windows: [],
  readAt: null,
  stale: false,
  error: null,
  source: "status",
  loginCommand: "claude auth login",
  ...over,
});
const host = (id: string) => ({ id, name: id, status: "online" as const });

describe("cota-por-conta: one quota card per Claude account (issue #111)", () => {
  test("hosts signed in to the same account share a group, in the order the hosts come", () => {
    const groups = quotaGroups([host("a"), host("b"), host("c")], {
      a: account(),
      b: account(),
      c: account({ name: "bia@example.com" }),
    });
    expect(groups.map((g) => g.hosts.map((h) => h.id))).toEqual([["a", "b"], ["c"]]);
  });

  test("the same email in another organization, a host not signed in and one with no reading each stay alone", () => {
    const groups = quotaGroups([host("a"), host("b"), host("c"), host("d"), host("e")], {
      a: account(),
      b: account({ organization: "Beta" }),
      c: account({ status: "signed_out", name: null }),
      d: account({ name: null }),
      // e: nothing read yet
    });
    expect(groups.map((g) => g.hosts.map((h) => h.id))).toEqual([
      ["a"],
      ["b"],
      ["c"],
      ["d"],
      ["e"],
    ]);
  });
});

/** The state the panel reads, with the readings of `a` only. */
function fakeStore(accounts: Record<string, AccountState>) {
  const window = { window: "five_hour", utilization: 0.14, resetsAt: null, status: "allowed" };
  const quota: Record<string, QuotaState> = {
    a: { windows: [window], pauseAt: 0.9, readAt: new Date().toISOString() } as never,
  };
  const hosts = ["a", "b", "c"].map((id) => ({
    ...host(id),
    hostInfo: { features: ["quota", "account"] },
  }));
  const state = { hosts, quota, account: accounts };
  const watched: string[] = [];
  const store = {
    i18n: { t: translator("en") },
    now: () => Date.now(),
    formatTime: (iso: string) => iso,
    subscribe: () => () => undefined,
    getState: () => state,
    hostCommand: async () => null,
    watchAccount: (id: string) => {
      watched.push(id);
      return () => undefined;
    },
  };
  return { store: store as never, watched };
}

describe("cota-por-conta: the panel", () => {
  test("three hosts on one account show one card that names them all, and each host's account is watched", async () => {
    const same = account();
    const { store, watched } = fakeStore({ a: same, b: same, c: same });
    render(<QuotaPanel store={store} />);
    await settle(() => screen.queryAllByRole("region").length > 0);
    expect(screen.queryAllByRole("region")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Quota of a · b · c" })).toBeTruthy();
    expect(watched.sort()).toEqual(["a", "b", "c"]);
  });

  test("hosts on different accounts keep a card each", async () => {
    const { store } = fakeStore({
      a: account(),
      b: account({ name: "bia@example.com" }),
      c: account({ name: "caio@example.com" }),
    });
    render(<QuotaPanel store={store} />);
    await settle(() => screen.queryAllByRole("region").length > 0);
    expect(screen.queryAllByRole("region")).toHaveLength(3);
  });
});
