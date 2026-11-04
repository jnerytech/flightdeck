import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Account } from "../../daemon/src/account/account.ts";
import { Quota } from "../../daemon/src/quota/quota.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
/** The page itself: the sidebar's account row shows the first host's email too. */
const page = () =>
  within(document.querySelector('[aria-label^="Area"], [aria-label^="Área"]') as HTMLElement);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);

/** A daemon whose account is `email`'s; none when `email` is null. */
function accountFor(email: string | null) {
  if (email === null) return undefined;
  const quota = new Quota({ pauseAt: 0.9 });
  const account = new Account({
    quota,
    readers: {
      status: async () => ({
        loggedIn: true,
        authMethod: "claude.ai",
        apiProvider: "firstParty",
        email,
        organization: null,
        plan: "max",
      }),
      sdk: async () => ({ info: null, usage: { plan: "max", available: true, windows: [] } }),
    },
  });
  return { quota, account };
}

async function setup(hosts: Array<{ name: string; email: string | null }>) {
  const mem = memoryPlatform(false, "en");
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const accounts: Record<string, Account | undefined> = {};
  const ids: Record<string, string> = {};
  for (const { name, email } of hosts) {
    const made = accountFor(email);
    const d = makeDaemon(cleanups, made ? { quota: made.quota, account: made.account } : {});
    const server = d.listen();
    accounts[name] = made?.account;
    ids[name] = await act(() => store.addHost({ name, url: server.url, token: TOKEN }));
  }
  await settle(() => store.getState().hosts.every((h) => h.status === "online"));
  const open = async (name: string) => {
    await act(async () => {
      store.router.push({ name: "host", host: ids[name] as string });
    });
  };
  const watchers = (name: string) =>
    (accounts[name] as unknown as { watchers: Set<unknown> }).watchers.size;
  return { store, open, watchers };
}

const card = (host: string) => screen.queryByRole("region", { name: `Claude account of ${host}` });

describe("conta-pagina-host: the host page", () => {
  test("shows the account card above the usage panel", async () => {
    const { open } = await setup([{ name: "alfa", email: "alfa@example.com" }]);
    await open("alfa");
    await settle(() => card("alfa") !== null);
    await settle(() => page().queryByText("alfa@example.com") !== null);
    const usage = screen.queryByRole("region", { name: "Usage in the last 7 days" });
    expect(usage).not.toBeNull();
    const order = (card("alfa") as HTMLElement).compareDocumentPosition(usage as HTMLElement);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("a host whose daemon has no account shows no card", async () => {
    const { open } = await setup([{ name: "alfa", email: null }]);
    await open("alfa");
    await settle(() => screen.queryByRole("heading", { name: "alfa" }) !== null);
    expect(card("alfa")).toBeNull();
  });

  test("each host shows its own account, and the stream follows the open page", async () => {
    const { open, watchers } = await setup([
      { name: "alfa", email: "alfa@example.com" },
      { name: "beta", email: "beta@example.com" },
    ]);
    await open("alfa");
    await settle(() => page().queryByText("alfa@example.com") !== null);
    expect(page().queryByText("beta@example.com")).toBeNull();
    expect(watchers("alfa")).toBe(1);
    await open("beta");
    await settle(() => page().queryByText("beta@example.com") !== null);
    expect(page().queryByText("alfa@example.com")).toBeNull();
    await settle(() => watchers("alfa") === 0);
    expect(watchers("beta")).toBe(1);
  });
});
