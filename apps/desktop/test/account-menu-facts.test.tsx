import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { AccountState } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AccountFooter } = await import("../src/components/shell/account-footer.tsx");
const { AppStore } = await import("../src/lib/app-store.ts");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");
const { App } = await import("../src/ui/App.tsx");
const { footAccount } = await import("../src/lib/foot-account.ts");
const { APP_VERSION } = await import("../src/lib/version.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

const account = (over: Partial<AccountState> = {}): AccountState => ({
  status: "signed_in",
  name: "ana@example.com",
  organization: null,
  plan: "max",
  provider: "firstParty",
  windows: [],
  readAt: "2026-11-06T12:00:00Z",
  stale: false,
  error: null,
  source: "sdk",
  loginCommand: "claude auth login",
  ...over,
});

/** The footer alone, in English, writing down what each item asked for. */
function footer(over: { account?: AccountState | null; hostId?: string | null } = {}) {
  const store = new AppStore(memoryPlatform(false, "en").platform);
  store.i18n.start();
  const calls: string[] = [];
  render(
    <AccountFooter
      account={over.account === undefined ? account() : over.account}
      hostId={over.hostId === undefined ? "h1" : over.hostId}
      many={0}
      collapsed={false}
      version="1.2.3"
      density="compact"
      t={store.i18n.t}
      go={(route) => void calls.push(`go ${route.name}`)}
      onToggleTheme={() => void calls.push("theme")}
      onOpenManual={() => void calls.push("manual")}
      onOpen={() => {}}
      githubHosts={[]}
      onSignOutGithub={() => {}}
      onCopy={(text: string) => void calls.push(`copy ${text}`)}
      onDensity={(density: string) => void calls.push(`density ${density}`)}
      hideBadges={false}
      onHideBadges={() => {}}
      hideWhatsNew={false}
      onHideWhatsNew={() => {}}
      hideSetup={false}
      onHideSetup={() => {}}
      onCheckUpdates={() => void calls.push("check updates")}
      onShortcuts={() => void calls.push("shortcuts")}
      hasNew={false}
      onWhatsNew={() => void calls.push("whats new")}
    />,
  );
  return calls;
}

async function openMenu() {
  const trigger = screen
    .getAllByRole("button")
    .find((b) => b.getAttribute("data-slot") === "account-trigger") as HTMLElement;
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  });
  await screen.findByRole("menu");
}

async function choose(name: string | RegExp) {
  const item =
    screen.queryByRole("menuitem", { name }) ?? screen.queryByRole("menuitemcheckbox", { name });
  expect(item).not.toBeNull();
  await act(async () => {
    fireEvent.click(item as HTMLElement);
  });
}

describe("account-menu-facts: the account menu says what the app is and copies the facts (issue #282)", () => {
  test("its header names the app and its version", async () => {
    footer();
    await openMenu();
    const menu = screen.getByRole("menu");
    expect(menu.textContent ?? "").toContain("Flightdeck");
    expect(menu.textContent ?? "").toContain("Version 1.2.3");
  });

  test("the plan, the account and the host id are items that copy their value", async () => {
    const calls = footer();
    await openMenu();
    await choose("Copy the plan: Max");
    await openMenu();
    await choose("Copy the account: ana@example.com");
    await openMenu();
    await choose("Copy the host id: h1");
    expect(calls).toEqual(["copy Max", "copy ana@example.com", "copy h1"]);
  });

  test("with no account read and no host there is nothing to copy", async () => {
    footer({ account: null, hostId: null });
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: /^Copy/ })).toBeNull();
  });

  test("Compact rows is a switch with its state; choosing it asks for the other density", async () => {
    const calls = footer();
    await openMenu();
    const item = screen.queryByRole("menuitemcheckbox", { name: "Compact rows" });
    expect(item?.getAttribute("aria-checked")).toBe("true");
    await choose("Compact rows");
    expect(calls).toEqual(["density comfortable"]);
  });

  test("Check for updates and Keyboard shortcuts are actions of the menu", async () => {
    const calls = footer();
    await openMenu();
    await choose("Check for updates");
    await openMenu();
    await choose("Keyboard shortcuts");
    expect(calls).toEqual(["check updates", "shortcuts"]);
  });
});

describe("account-menu-facts: the host whose account the foot shows (issue #282)", () => {
  const host = (id: string) => ({ id, name: id, status: "online", sessions: [] });
  const state = (accounts: Record<string, AccountState>, ids = Object.keys(accounts)) =>
    ({ hosts: ids.map(host), account: accounts }) as never;

  test("the open host's; with none open, the host of the account shown; none when they differ", () => {
    const shared = state({ a: account(), b: account() });
    expect(footAccount(shared, { name: "session", host: "b", id: "s" } as never).hostId).toBe("b");
    expect(footAccount(shared, { name: "hub" } as never).hostId).toBe("a");
    const differ = state({ a: account(), b: account({ name: "bia@example.com" }) });
    expect(footAccount(differ, { name: "hub" } as never).hostId).toBeNull();
    expect(footAccount(state({}, ["a"]), { name: "hub" } as never).hostId).toBeNull();
  });
});

describe("account-menu-facts: the sidebar wires the menu to the app (issue #282)", () => {
  function sidebar(withAccount = false) {
    const store = new AppStore(memoryPlatform(false, "en").platform);
    store.i18n.start();
    const copied: string[] = [];
    store.copyText = async (text: string) => {
      copied.push(text);
      return true;
    };
    const base = store.getState();
    const state = withAccount
      ? ({
          ...base,
          hosts: [{ id: "h1", name: "alfa", status: "online", sessions: [] }],
          account: { h1: account() },
        } as never)
      : base;
    const routes: string[] = [];
    let checks = 0;
    let shortcuts = 0;
    store.checkAppUpdate = async () => {
      checks += 1;
    };
    render(
      <Sidebar
        store={store}
        state={state}
        collapsed={false}
        t={store.i18n.t}
        go={(r) => void routes.push(r.name)}
        onOpenProjectScreen={() => {}}
        onNewSession={() => {}}
        onRemoveHost={() => {}}
        onRenameHost={() => null}
        onOpenSearch={() => {}}
        onNewTab={() => {}}
        onToggleTheme={() => {}}
        onShortcuts={() => {
          shortcuts += 1;
        }}
      />,
    );
    return { store, routes, copied, counts: () => ({ checks, shortcuts }) };
  }

  test("the header shows the app's own version", async () => {
    sidebar();
    await openMenu();
    expect(screen.getByRole("menu").textContent ?? "").toContain(`Version ${APP_VERSION}`);
  });

  test("a fact chosen in the menu goes to the clipboard through the store", async () => {
    const { copied } = sidebar(true);
    await openMenu();
    await choose("Copy the host id: h1");
    expect(copied).toEqual(["h1"]);
  });

  test("Compact rows switches the app's density, kept on this computer", async () => {
    const { store } = sidebar();
    expect(store.density.value).toBe("compact");
    await openMenu();
    await choose("Compact rows");
    expect(store.density.value).toBe("comfortable");
  });

  test("Check for updates opens Settings, where the answer shows, and asks the updater", async () => {
    const { routes, counts } = sidebar();
    await openMenu();
    await choose("Check for updates");
    await openMenu();
    await choose("Keyboard shortcuts");
    expect([routes, counts()]).toEqual([["settings"], { checks: 1, shortcuts: 1 }]);
  });
});

describe("account-menu-facts: the app opens the shortcuts sheet from the menu (issue #282)", () => {
  test("Keyboard shortcuts in the account menu opens the sheet of shortcuts", async () => {
    const store = new AppStore(memoryPlatform(false, "en").platform);
    render(<App store={store} />);
    await openMenu();
    await choose("Keyboard shortcuts");
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeNull();
  });
});
