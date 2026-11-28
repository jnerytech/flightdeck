import { afterEach, describe, expect, test } from "bun:test";
import type { AccountState, QuotaState } from "@flightdeck/protocol";
import { registerDom } from "../dom.ts";
import { waiter } from "../wait.ts";

registerDom();
const { cleanup, render, screen, within } = await import("@testing-library/react");
const { quotaGroups } = await import("../../src/features/quota/domain/quota.ts");
const { QuotaPanel } = await import("../../src/features/quota/quota-panel.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");

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
function fakeStore(
  accounts: Record<string, AccountState>,
  over: {
    quota?: Record<string, QuotaState>;
    features?: string[];
    /** The features of one host, when they differ from `features`. */
    hostFeatures?: Record<string, string[]>;
  } = {},
) {
  const window = { window: "five_hour", utilization: 0.14, resetsAt: null, status: "allowed" };
  const quota: Record<string, QuotaState> = over.quota ?? {
    a: { windows: [window], pauseAt: 0.9, readAt: new Date().toISOString() } as never,
  };
  const hosts = ["a", "b", "c"].map((id) => ({
    ...host(id),
    hostInfo: { features: over.hostFeatures?.[id] ?? over.features ?? ["quota", "account"] },
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
    account: {
      watch: (id: string) => {
        watched.push(id);
        return () => undefined;
      },
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

  // #4301: the guard is each host's own, so a card of hosts on one account shows each one named.
  const reading = (utilization: number, pauseAt: number): QuotaState =>
    ({
      windows: [{ window: "five_hour", utilization, resetsAt: null, status: "allowed" }],
      pauseAt,
      readAt: new Date().toISOString(),
    }) as never;
  const sharedCard = (quota: Record<string, QuotaState>) => {
    const same = account();
    const { store } = fakeStore(
      { a: same, b: same },
      { quota, features: ["quota", "account", "quotaPause"] },
    );
    render(
      <TContext.Provider value={translator("en")}>
        <QuotaPanel store={store} />
      </TContext.Provider>,
    );
    return screen.getByRole("region", { name: "Quota of a · b" });
  };
  const guards = (card: HTMLElement) =>
    within(card)
      .queryAllByRole("combobox")
      .map((select) => [
        select.getAttribute("aria-label"),
        (select as HTMLSelectElement).value,
        card.querySelector(`label[for="${select.id}"]`)?.textContent ?? "",
      ]);

  test("a hot card of two hosts shows the guard of each, named, with its own value", async () => {
    const card = sharedCard({ a: reading(0.6, 0.5), b: reading(0.6, 0.9) });
    expect(guards(card).map(([name, value]) => [name, value])).toEqual([
      ["New cards wait from, on a", "0.5"],
      ["New cards wait from, on b", "0.9"],
    ]);
    expect(guards(card).map(([, , label]) => label)).toEqual([
      "New cards wait from, on a",
      "New cards wait from, on b",
    ]);
  });

  test("a host that cannot change its guard from the app is named too, in the card", async () => {
    const same = account();
    const { store } = fakeStore(
      { a: same, b: same },
      {
        quota: { a: reading(0.6, 0.5), b: reading(0.6, 0.9) },
        features: ["quota", "account", "quotaPause"],
        hostFeatures: { b: ["quota", "account"] },
      },
    );
    render(
      <TContext.Provider value={translator("en")}>
        <QuotaPanel store={store} />
      </TContext.Provider>,
    );
    const card = screen.getByRole("region", { name: "Quota of a · b" });
    expect(card.textContent?.includes("b: New cards wait from 90%")).toBe(true);
  });

  test("a card where only one host has a reading shows its guard without the other's name", async () => {
    const card = sharedCard({ a: reading(0.6, 0.5) });
    expect(guards(card).map(([, , label]) => label)).toEqual(["New cards wait from"]);
  });

  test("the hot notice names each hot host with its own guard, not one percent for both", async () => {
    const card = sharedCard({ a: reading(0.6, 0.5), b: reading(0.6, 0.9) });
    const text = card.textContent ?? "";
    expect(text).toContain("a: over 50%");
    expect(text).not.toContain("a · b: over");
    expect(text).not.toContain("b: over");
  });

  test("when both hosts are hot, each notice has its own percent", async () => {
    const card = sharedCard({ a: reading(0.95, 0.5), b: reading(0.95, 0.9) });
    const text = card.textContent ?? "";
    expect(text).toContain("a: over 50%");
    expect(text).toContain("b: over 90%");
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
