import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { AccountState } from "@flightdeck/protocol";
import { chooseFromAccountMenu } from "./account-menu.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const account = (over: Partial<AccountState> = {}): AccountState => ({
  status: "signed_in",
  name: "ana@example.com",
  organization: null,
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

function setup(
  accounts: Record<string, AccountState> = { h1: account() },
  options: { route?: import("../src/lib/router.ts").Route; offline?: string[] } = {},
) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const state = {
    ...store.getState(),
    account: accounts,
    hosts: [
      {
        id: "h2",
        name: "beta",
        status: options.offline?.includes("h2") ? "offline" : "online",
        hostInfo: { daemonVersion: "x", features: [] },
        sessions: [],
      },
      {
        id: "h1",
        name: "alfa",
        status: options.offline?.includes("h1") ? "offline" : "online",
        hostInfo: { daemonVersion: "x", features: [] },
        sessions: [],
      },
    ],
  } as never as ReturnType<typeof store.getState>;
  const opened: string[] = [];
  const routes: unknown[] = [];
  let themed = 0;
  store.openLink = ((url: string) => void opened.push(url)) as never;
  const view = (collapsed = false) => (
    <Sidebar
      store={store}
      state={state}
      collapsed={collapsed}
      t={store.i18n.t}
      go={(route) => void routes.push(route)}
      {...(options.route ? { route: options.route } : {})}
      onOpenProjectScreen={() => {}}
      onNewSession={() => {}}
      onRemoveHost={() => {}}
      onRenameHost={() => null}
      onOpenSearch={() => {}}
      onNewTab={() => {}}
      onToggleTheme={() => void themed++}
    />
  );
  return { view, opened, routes, themed: () => themed };
}

describe("sidebar-conta: the account at the foot of the bar", () => {
  test("it shows the Claude account's email and plan, from the first host that has one", () => {
    const { view } = setup({ h1: account() });
    render(view());
    const row = screen.getByRole("button", { name: "Account menu for ana@example.com" });
    expect(row.textContent).toContain("ana@example.com");
    expect(row.textContent).toContain("Max plan");
    expect(row.textContent).toContain("A");
  });

  test("the foot shows the account of the host that is open, not always the first host's (HK-M4)", () => {
    const accounts = { h1: account(), h2: account({ name: "bo@example.com" }) };
    const open = (host: string) => {
      const { view } = setup(accounts, { route: { name: "host", host } });
      const { unmount } = render(view());
      const text = screen.getByRole("button", { name: /^Account menu for / }).textContent;
      unmount();
      return text;
    };
    expect(open("h1")).toContain("ana@example.com");
    expect(open("h2")).toContain("bo@example.com");
  });

  test("with no host open and different accounts it says how many, and the same account is shown once (HK-M4)", () => {
    const { view } = setup({ h1: account(), h2: account({ name: "bo@example.com" }) });
    const { unmount } = render(view());
    expect(screen.getByRole("button", { name: "Account menu for 2 accounts" })).toBeTruthy();
    unmount();
    const same = setup({ h1: account(), h2: account() });
    render(same.view());
    expect(screen.getByRole("button", { name: "Account menu for ana@example.com" })).toBeTruthy();
  });

  test("the account of an offline host is not shown (HK-M4)", () => {
    const { view } = setup(
      { h1: account(), h2: account({ name: "bo@example.com" }) },
      { offline: ["h2"] },
    );
    render(view());
    expect(screen.getByRole("button", { name: "Account menu for ana@example.com" })).toBeTruthy();
  });

  test("with no account read it says so instead of leaving the foot empty", () => {
    const { view } = setup({});
    render(view());
    const row = screen.getByRole("button", { name: "Account menu for Claude account" });
    expect(row.textContent).toContain("Claude account");
    expect(row.textContent).toContain("Not read yet");
  });

  test("the menu holds Settings, Toggle theme and Manual, which do what they say", async () => {
    const { view, routes, opened, themed } = setup();
    render(view());
    await chooseFromAccountMenu("Settings");
    expect(routes).toEqual([{ name: "settings" }]);
    await chooseFromAccountMenu("Toggle theme");
    expect(themed()).toBe(1);
    // The manual leaves the app, and its icon says so.
    const trigger = screen.getByRole("button", { name: /^Account menu for / });
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    });
    const manual = await screen.findByRole("menuitem", { name: "Manual" });
    expect(manual.querySelector("[data-slot='nav-external']")).not.toBeNull();
    await act(async () => void fireEvent.click(manual));
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/docs\/manual\/en\.md$/);
  });

  test("Toggle theme and Manual are not separate buttons in the bar, Settings and Search are (issue #213)", () => {
    const { view } = setup();
    render(view());
    expect(screen.getByRole("button", { name: "Settings" })).not.toBeNull();
    for (const name of ["Toggle theme", "Manual"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.getByRole("button", { name: "Search the history (Ctrl+K)" })).not.toBeNull();
  });

  test("in the collapsed rail the account is its initial, and still opens the menu", async () => {
    const { view, routes } = setup();
    render(view(true));
    const row = screen.getByRole("button", { name: "Account menu for ana@example.com" });
    expect(row.textContent).not.toContain("ana@example.com");
    await chooseFromAccountMenu("Settings");
    expect(routes).toEqual([{ name: "settings" }]);
    expect(within(document.body).queryByText("Max plan")).toBeNull();
    await act(async () => void fireEvent.keyDown(document.body, { key: "Escape" }));
  });
});
