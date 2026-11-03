import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Account } from "../../daemon/src/account/account.ts";
import { Quota } from "../../daemon/src/quota/quota.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { renderProbe } from "./render-probe.tsx";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { useStoreSlice } = await import("../src/lib/use-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { AppStore } = await import("../src/lib/app-store.ts");
const { HostAccount } = await import("../src/ui/HostAccount.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);

/** Something on other state: it must not render when the account changes. */
function Other(props: { store: InstanceType<typeof AppStore> }) {
  const { hosts } = useStoreSlice(props.store, ["hosts"]);
  return <p>{`hosts: ${hosts.length}`}</p>;
}

describe("conta-enxuta: an account push renders the card and nothing else", () => {
  test("a new reading re-renders the card, and a component on other state does not render", async () => {
    const quota = new Quota({ pauseAt: 0.9 });
    const account = new Account({
      quota,
      readers: {
        status: async () => ({
          loggedIn: true,
          authMethod: "claude.ai",
          apiProvider: "firstParty",
          email: "demo@example.com",
          organization: null,
          plan: "max",
        }),
        sdk: async () => ({ info: null, usage: { plan: "max", available: true, windows: [] } }),
      },
    });
    const d = makeDaemon(cleanups, { quota, account });
    const server = d.listen();
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    await act(async () => {
      await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    const host = store.getState().hosts[0];
    if (!host) throw new Error("no host");

    const cardProbe = renderProbe("card");
    const otherProbe = renderProbe("other");
    render(
      <TContext.Provider value={translator("en")}>
        {cardProbe.wrap(<HostAccount store={store} host={host} />)}
        {otherProbe.wrap(<Other store={store} />)}
      </TContext.Provider>,
    );
    await settle(() => screen.queryByText("demo@example.com") !== null);
    const card = cardProbe.snapshot();
    const other = otherProbe.snapshot();

    await act(async () => {
      quota.record([
        {
          window: "five_hour",
          utilization: 0.5,
          status: "allowed",
          resetsAt: Date.now() + 3_600_000,
        },
      ]);
    });
    await settle(() => screen.queryAllByRole("meter").length === 1);
    expect(cardProbe.since(card).commits).toBeGreaterThan(0);
    expect(otherProbe.since(other).commits).toBe(0);
  });
});
