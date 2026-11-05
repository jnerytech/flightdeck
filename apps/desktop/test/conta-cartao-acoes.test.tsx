import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Account, type AccountReaders } from "../../daemon/src/account/account.ts";
import type { AuthStatus } from "../../daemon/src/account/readers.ts";
import { Quota } from "../../daemon/src/quota/quota.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
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
const utcTime = (iso: string) => new Date(iso).toISOString().slice(11, 16);

const signedIn: AuthStatus = {
  loggedIn: true,
  authMethod: "claude.ai",
  apiProvider: "firstParty",
  email: "demo@example.com",
  organization: "Demo Org",
  plan: "max",
};
const signedOut: AuthStatus = {
  loggedIn: false,
  authMethod: "none",
  apiProvider: "firstParty",
  email: null,
  organization: null,
  plan: null,
};

/** A host with an account on a manual clock; the plan changes from the second read on. */
async function mount(kind: "in" | "out" = "in", cooldownMs = 50) {
  let clock = Date.now();
  const quota = new Quota({ pauseAt: 0.9, now: () => clock });
  let reads = 0;
  const readers: AccountReaders = {
    status: async () => {
      reads++;
      return kind === "in" ? { ...signedIn, plan: reads === 1 ? "max" : "pro" } : signedOut;
    },
    sdk: async () => ({
      info: null,
      usage: {
        plan: null,
        available: true,
        windows: [
          { window: "five_hour", utilization: 0.4, status: "allowed", resetsAt: clock + 3_600_000 },
        ],
      },
    }),
  };
  const account = new Account({ quota, readers, now: () => clock });
  const d = makeDaemon(cleanups, { quota, account });
  const server = d.listen();
  const mem = memoryPlatform(false, "en");
  const store = new AppStore(mem.platform, {
    baseDelayMs: 60_000,
    now: () => clock,
    formatTime: utcTime,
  });
  cleanups.push(() => store.dispose());
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const host = store.getState().hosts[0];
  if (!host) throw new Error("no host");
  const view = render(
    <TContext.Provider value={translator("en")}>
      <HostAccount store={store} host={host} cooldownMs={cooldownMs} />
    </TContext.Provider>,
  );
  const watchers = () => (account as unknown as { watchers: Set<unknown> }).watchers.size;
  return {
    ...mem,
    store,
    host,
    account,
    view,
    watchers,
    reads: () => reads,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const button = (name: string | RegExp) => screen.queryByRole("button", { name });
const click = async (name: string | RegExp) => {
  const el = button(name);
  expect(el).not.toBeNull();
  await act(async () => {
    fireEvent.click(el as HTMLElement);
  });
};

describe("conta-cartao-acoes: the card watches while it is on screen", () => {
  test("mounting starts the host's account stream and shows the account", async () => {
    const { watchers } = await mount();
    await settle(() => screen.queryByText("demo@example.com") !== null);
    expect(screen.queryByText("Max")).not.toBeNull();
    expect(screen.queryAllByRole("meter")).toHaveLength(1);
    expect(watchers()).toBe(1);
  });

  test("unmounting ends the stream", async () => {
    const { watchers, view } = await mount();
    await settle(() => screen.queryByText("demo@example.com") !== null);
    view.unmount();
    await settle(() => watchers() === 0);
    expect(watchers()).toBe(0);
  });
});

describe("conta-cartao-acoes: refresh", () => {
  test("asks the host to read now; the button is off while it runs and for the cooldown after", async () => {
    const { advance, reads } = await mount("in", 150);
    await settle(() => screen.queryByText("demo@example.com") !== null);
    advance(31_000);
    await click("Refresh the account of alfa");
    await settle(() => screen.queryByText("Pro") !== null);
    expect(reads()).toBe(2);
    const off = button("Refresh the account of alfa") as HTMLButtonElement;
    expect(off.disabled).toBe(true);
    await settle(
      () => (button("Refresh the account of alfa") as HTMLButtonElement).disabled === false,
    );
  });

  test("a refresh the host refuses as too soon is told to the person, with the seconds to wait", async () => {
    const { store } = await mount();
    await settle(() => screen.queryByText("demo@example.com") !== null);
    await click("Refresh the account of alfa");
    await settle(() => store.getState().notices.length > 0);
    const notice = store.getState().notices.at(-1);
    expect(notice?.reason).toBe("account_refresh_too_soon");
    expect(typeof notice?.params?.waitSeconds).toBe("number");
  });
});

describe("conta-cartao-acoes: signed out", () => {
  test("Copy command copies `claude auth login` and says so", async () => {
    const { platform } = await mount("out");
    const copied: string[] = [];
    platform.copyText = async (text) => {
      copied.push(text);
    };
    await settle(() => button("Copy command") !== null);
    await click("Copy command");
    expect(copied).toEqual(["claude auth login"]);
    await settle(() => button("Command copied") !== null);
  });

  test("Open terminal opens the host's terminal", async () => {
    const { store, host } = await mount("out");
    const opened: string[] = [];
    store.openTerminal = async (hostId) => {
      opened.push(hostId);
      return "t1";
    };
    await settle(() => button("Open terminal") !== null);
    await click("Open terminal");
    expect(opened).toEqual([host.id]);
  });

  test("nothing in the card is an input", async () => {
    await mount("out");
    await settle(() => button("Copy command") !== null);
    expect(document.querySelector("input, textarea, select")).toBeNull();
  });
});

describe("conta-cartao-acoes: a host that goes away", () => {
  test("shows offline instead of the old reading, and the stream ends", async () => {
    const { store, host, view, watchers } = await mount();
    await settle(() => screen.queryByText("demo@example.com") !== null);
    view.rerender(
      <TContext.Provider value={translator("en")}>
        <HostAccount store={store} host={{ ...host, status: "offline" }} />
      </TContext.Provider>,
    );
    await settle(() => screen.queryByText("demo@example.com") === null);
    expect(screen.queryByText(/alfa is offline/)).not.toBeNull();
    await settle(() => watchers() === 0);
  });
});
