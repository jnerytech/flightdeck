import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { GithubStatusResult } from "@flightdeck/protocol";
import { chooseFromAccountMenu } from "./account-menu.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");
const { githubSignedIn } = await import("../src/lib/github-session.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

const signedIn = (over: Partial<GithubStatusResult> = {}): GithubStatusResult => ({
  installed: true,
  loggedIn: true,
  login: "ana",
  scopes: [],
  source: "keyring",
  ...over,
});

const host = (id: string, name: string, over: object = {}) => ({
  id,
  name,
  status: "online",
  hostInfo: { daemonVersion: "x", features: ["github"] },
  sessions: [],
  ...over,
});

function fakeStore(statuses: Record<string, GithubStatusResult>) {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    hostCommand: (async (hostId: string, type: string) => {
      calls.push([hostId, type]);
      return type === "github.status" ? (statuses[hostId] ?? null) : undefined;
    }) as never,
  };
}

describe("sidebar-config: which hosts can sign out of GitHub (issue #213)", () => {
  test("online hosts that offer GitHub and are signed in with a removable login", async () => {
    const store = fakeStore({
      a: signedIn(),
      b: signedIn({ source: "env" }),
      c: signedIn({ loggedIn: false, login: null }),
      d: signedIn({ installed: false }),
      f: signedIn(),
    });
    const hosts = [
      host("a", "alfa"),
      host("b", "beta"),
      host("c", "gama"),
      host("d", "delta"),
      host("e", "epsilon", { status: "offline" }),
      host("f", "zeta", { hostInfo: { daemonVersion: "x", features: [] } }),
    ];
    expect(await githubSignedIn(store, hosts as never)).toEqual([{ id: "a", name: "alfa" }]);
    // Hosts that do not offer GitHub or are not online are never asked.
    expect(store.calls.map(([id]) => id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("a host that does not answer is left out", async () => {
    const store = fakeStore({});
    expect(await githubSignedIn(store, [host("a", "alfa")] as never)).toEqual([]);
  });
});

function setup(
  statuses: Record<string, GithubStatusResult>,
  hosts = [host("h1", "alfa")],
  route?: object,
) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const fake = fakeStore(statuses);
  store.hostCommand = fake.hostCommand;
  const state = { ...store.getState(), hosts } as never as ReturnType<typeof store.getState>;
  const routes: unknown[] = [];
  render(
    <Sidebar
      store={store}
      state={state}
      collapsed={false}
      t={store.i18n.t}
      go={(r) => void routes.push(r)}
      {...(route ? { route: route as never } : {})}
      onOpenProjectScreen={() => {}}
      onNewSession={() => {}}
      onRemoveHost={() => {}}
      onRenameHost={() => null}
      onOpenSearch={() => {}}
      onNewTab={() => {}}
      onToggleTheme={() => {}}
    />,
  );
  return { routes, calls: fake.calls };
}

describe("sidebar-config: Settings is a visible item with an active state (issue #213)", () => {
  test("it sits in the foot, opens Settings, and is marked while Settings is open", async () => {
    const { routes } = setup({});
    const item = screen.getByRole("button", { name: "Settings" });
    expect(item.getAttribute("aria-current")).toBeNull();
    await act(async () => {
      fireEvent.click(item);
    });
    expect(routes).toEqual([{ name: "settings" }]);
    cleanup();
    setup({}, undefined, { name: "settings" });
    const open = screen.getByRole("button", { name: "Settings" });
    expect(open.getAttribute("aria-current")).toBe("page");
    expect(open.className).toContain("nav-active");
  });

  test("it comes after Search and before the account row", () => {
    setup({});
    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
    const at = (needle: RegExp) => names.findIndex((n) => needle.test(n));
    expect(at(/^Settings/)).toBeGreaterThan(at(/Search/));
    expect(at(/^Settings/)).toBeLessThan(at(/Account menu/));
  });
});

describe("sidebar-config: Sign out of GitHub in the account menu (issue #213)", () => {
  test("a signed-in host offers it; confirming signs that host out, cancelling does nothing", async () => {
    const { calls } = setup({ h1: signedIn() });
    await chooseFromAccountMenu("Sign out of GitHub");
    expect(screen.getByText(/Sign out of GitHub on alfa\?/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Cancel/ }));
    });
    expect(calls.filter(([, type]) => type === "github.logout")).toEqual([]);
    await chooseFromAccountMenu("Sign out of GitHub");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign out of GitHub" }));
    });
    await settle(() => calls.some(([, type]) => type === "github.logout"));
    expect(calls.filter(([, type]) => type === "github.logout")).toEqual([["h1", "github.logout"]]);
  });

  test("with two signed-in hosts each item names its host", async () => {
    setup({ h1: signedIn(), h2: signedIn() }, [host("h1", "alfa"), host("h2", "beta")]);
    const trigger = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("data-slot") === "account-trigger") as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    });
    expect(await screen.findByRole("menuitem", { name: "Sign out of GitHub (alfa)" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Sign out of GitHub (beta)" })).toBeTruthy();
  });

  test("nobody signed in, or a login from the environment: no item", async () => {
    setup({ h1: signedIn({ source: "env" }) });
    const trigger = screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("data-slot") === "account-trigger") as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    });
    await screen.findByRole("menuitem", { name: "Toggle theme" });
    expect(screen.queryByRole("menuitem", { name: /Sign out of GitHub/ })).toBeNull();
  });
});
