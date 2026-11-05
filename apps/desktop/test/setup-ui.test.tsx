import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");
const { SetupPage } = await import("../src/ui/SetupPage.tsx");
const { Settings } = await import("../src/ui/Settings.tsx");
const { StartScreen } = await import("../src/ui/StartScreen.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const FEATURES = ["central", "workflows", "github", "costs"];
const host = (id: string, over: object = {}) => ({
  id,
  name: id,
  status: "online",
  url: "ws://x",
  token: "",
  info: null,
  hostInfo: { daemonVersion: "x", features: FEATURES },
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
  ...over,
});
const project = {
  id: "p",
  name: "api",
  path: "/work/api",
  baseBranch: "main",
  worktreeInclude: false,
};

function make(patch: object = {}, language: "en" | "pt-BR" = "en") {
  const mem = memoryPlatform(false, language);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const state = { ...store.getState(), setupProbes: {}, ...patch };
  return { store, mem, state: state as never as ReturnType<typeof store.getState> };
}

/** Everything the four core steps ask for. */
const COMPLETE = {
  hosts: [host("h1", { sessions: [{ id: "s", status: "idle", cwd: "/p", updatedAt: "t" }] })],
  projects: { h1: [project] },
  setupProbes: { h1: { hooks: "installed", github: false } },
};

function sidebar(w: ReturnType<typeof make>, collapsed = false) {
  const routes: unknown[] = [];
  render(
    <Sidebar
      store={w.store}
      state={w.state}
      collapsed={collapsed}
      t={w.store.i18n.t}
      go={(route) => void routes.push(route)}
      onOpenProjectScreen={() => {}}
      onNewSession={() => {}}
      onRemoveHost={() => {}}
      onRenameHost={() => null}
      onOpenSearch={() => {}}
      onNewTab={() => {}}
      onToggleTheme={() => {}}
    />,
  );
  return routes;
}
const click = (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el);
  });

describe("setup-ui: the sidebar row (issue #164)", () => {
  test("a fresh app shows Setup with its ring and 0/4, first in the Work group", () => {
    sidebar(make());
    const row = screen.getByRole("button", { name: "Setup, 0 of 4 steps done" });
    expect(row.textContent).toContain("0/4");
    expect(row.querySelector("[data-slot='setup-ring']")).not.toBeNull();
    const work = screen.getByRole("group", { name: "Work" });
    expect(within(work).getAllByRole("button")[0]).toBe(row);
  });

  test("a host online moves the ring to 1/4 without a reload, and losing it moves it back", () => {
    const w = make({ hosts: [host("h1")] });
    sidebar(w);
    expect(screen.getByRole("button", { name: "Setup, 1 of 4 steps done" })).toBeTruthy();
    cleanup();
    sidebar(make({ hosts: [] }));
    expect(screen.getByRole("button", { name: "Setup, 0 of 4 steps done" })).toBeTruthy();
  });

  test("the ring draws the share done", () => {
    sidebar(make({ hosts: [host("h1")] }));
    const ring = document.querySelector("[data-slot='setup-ring']") as HTMLElement;
    expect(ring.getAttribute("data-done")).toBe("1");
    expect(ring.getAttribute("data-total")).toBe("4");
  });

  test("a click opens the Setup screen", async () => {
    const routes = sidebar(make());
    await click(screen.getByRole("button", { name: /^Setup, / }));
    expect(routes).toEqual([{ name: "setup" }]);
  });

  test("Hide removes the row and is remembered; hidden at the start stays hidden", async () => {
    const w = make();
    sidebar(w);
    await click(screen.getByRole("button", { name: "Hide the setup checklist" }));
    expect(screen.queryByRole("button", { name: /^Setup, / })).toBeNull();
    expect(w.store.setup.hidden).toBe(true);
    cleanup();
    const again = make();
    again.mem.platform.storage.setItem("flightdeck.setupHidden", "on");
    sidebar(again);
    expect(screen.queryByRole("button", { name: /^Setup, / })).toBeNull();
  });

  test("the core steps done remove the row by themselves", () => {
    sidebar(make(COMPLETE));
    expect(screen.queryByRole("button", { name: /^Setup, / })).toBeNull();
  });

  test("the narrow rail keeps the ring and the name, without the count or the hide button", () => {
    sidebar(make(), true);
    const row = screen.getByRole("button", { name: "Setup, 0 of 4 steps done" });
    expect(row.textContent).not.toContain("0/4");
    expect(screen.queryByRole("button", { name: "Hide the setup checklist" })).toBeNull();
  });

  test("it reads in Portuguese", () => {
    sidebar(make({}, "pt-BR"));
    expect(
      screen.getByRole("button", { name: "Configuração inicial, 0 de 4 passos feitos" }),
    ).toBeTruthy();
  });
});

function page(w: ReturnType<typeof make>) {
  const routes: unknown[] = [];
  render(<SetupPage store={w.store} state={w.state} go={(route) => void routes.push(route)} />);
  return routes;
}

describe("setup-ui: the Setup screen (issue #164)", () => {
  test("a numbered list of steps: the first one to do is the current step", () => {
    page(make({ hosts: [host("h1")] }));
    const core = screen.getByRole("list", { name: "To get going" });
    const items = within(core).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]?.textContent).toContain("Connect a host");
    expect(items[0]?.textContent).toContain("Done");
    expect(items[1]?.getAttribute("aria-current")).toBe("step");
    expect(items.filter((i) => i.getAttribute("aria-current") === "step")).toHaveLength(1);
    expect(items[2]?.textContent).toContain("To do");
  });

  test("each step has one sentence and one action that opens the right screen", async () => {
    const routes = page(make({ hosts: [host("h1")] }));
    const core = screen.getByRole("list", { name: "To get going" });
    await click(within(core).getByRole("button", { name: "Open the host" }));
    await click(within(core).getByRole("button", { name: "Add a project" }));
    await click(within(core).getByRole("button", { name: "New session" }));
    expect(routes).toEqual([
      { name: "host", host: "h1" },
      { name: "projects", host: "h1" },
      { name: "new-session", host: "h1" },
    ]);
    expect(
      within(core).getByText(/lets a session you start in a terminal|The hooks let/),
    ).toBeTruthy();
  });

  test("a step that is done has no action", () => {
    page(make({ hosts: [host("h1")] }));
    const core = screen.getByRole("list", { name: "To get going" });
    expect(within(core).queryByRole("button", { name: "Add a host" })).toBeNull();
  });

  test("the optional steps follow, in their own list", () => {
    page(make({ hosts: [host("h1")] }));
    const optional = screen.getByRole("list", { name: "Worth doing" });
    expect(within(optional).getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
    expect(within(optional).getByText(/Sign in to GitHub/)).toBeTruthy();
  });

  test("when the core steps are done it says so, with no current step", () => {
    page(make(COMPLETE));
    expect(screen.getByText(/leaves the sidebar by itself/)).toBeTruthy();
    expect(document.querySelector("[aria-current='step']")).toBeNull();
  });

  test("Hide is on the screen too", async () => {
    const w = make();
    page(w);
    await click(screen.getByRole("button", { name: "Hide the setup checklist" }));
    expect(w.store.setup.hidden).toBe(true);
  });

  test("it reads in Portuguese", () => {
    page(make({}, "pt-BR"));
    expect(screen.getByRole("heading", { name: "Configuração inicial" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Para começar" })).toBeTruthy();
  });
});

describe("setup-ui: bringing the row back from Settings (issue #164)", () => {
  test("a checkbox shows the checklist again", async () => {
    const w = make();
    act(() => w.store.setup.setHidden(true));
    render(
      <Settings
        store={w.store}
        settings={{ ...w.store.getState().settings, updaterSupported: true }}
        onCloseToTray={() => {}}
        onAutostart={() => {}}
        onGlobalShortcut={() => {}}
        appUpdate={{ upToDate: false } as never}
        onCheckUpdate={() => {}}
        onNotifyUpdates={() => {}}
        theme="system"
        onTheme={() => {}}
        density="comfortable"
        onDensity={() => {}}
        lang="en"
        onLang={() => {}}
        t={w.store.i18n.t}
      />,
    );
    const box = screen.getByRole("checkbox", {
      name: "Show the setup checklist",
    }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await click(box);
    expect(w.store.setup.hidden).toBe(false);
  });
});

describe("setup-ui: a missing tool gets a quiet card on Start (issue #164)", () => {
  const dep = (id: string, group: string, state: string) => ({
    id,
    group,
    state,
    breaks: [],
    fix: [{ os: "linux", url: "https://cli.github.com" }],
  });
  function start(w: ReturnType<typeof make>) {
    (w.store as unknown as { update(p: object): void }).update({
      deps: { h1: { items: [dep("gh", "optional", "missing"), dep("git", "required", "ok")] } },
    });
    render(<StartScreen store={w.store} hosts={[host("h1")] as never} go={() => {}} />);
  }

  test("it names the tool and the host, links the fix and can be dismissed for good", async () => {
    const w = make({}, "pt-BR");
    start(w);
    const card = screen.getByRole("note", { name: /gh não está em h1/ });
    expect(within(card).getByText("Alguns recursos precisam dele.")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Como instalar" }).getAttribute("href")).toBe(
      "https://cli.github.com",
    );
    await click(within(card).getByRole("button", { name: "Dispensar" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(w.store.setup.dismissedTools()).toEqual(["gh@h1"]);
    cleanup();
    start(w);
    expect(screen.queryByRole("note")).toBeNull();
  });

  test("a tool that is there shows no card", () => {
    const w = make({}, "pt-BR");
    (w.store as unknown as { update(p: object): void }).update({
      deps: { h1: { items: [dep("gh", "optional", "ok")] } },
    });
    render(<StartScreen store={w.store} hosts={[host("h1")] as never} go={() => {}} />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("setup-ui: what the hosts answer (issue #164)", () => {
  function asked(w: ReturnType<typeof make>, answers: Record<string, unknown>) {
    const calls: string[] = [];
    w.store.hostCommand = (async (_host: string, type: string) => {
      calls.push(type);
      return answers[type] ?? null;
    }) as never;
    w.store.loadProjects = (async () => {
      calls.push("loadProjects");
      return [];
    }) as never;
    return calls;
  }

  test("a host with hooks and GitHub is asked for both, and its projects are loaded", async () => {
    const w = make({ hosts: [host("h1")] });
    const internals = w.store as unknown as { update(p: object): void };
    internals.update({ hosts: [host("h1")] });
    const calls = asked(w, {
      "hooks.status": { status: "installed" },
      "github.status": { installed: true, loggedIn: true },
    });
    await w.store.refreshSetup("h1");
    expect(calls.sort()).toEqual(["github.status", "hooks.status", "loadProjects"]);
    expect(w.store.getState().setupProbes.h1).toEqual({ hooks: "installed", github: true });
  });

  test("an answer that says no, or no answer, is recorded as such", async () => {
    const w = make();
    (w.store as unknown as { update(p: object): void }).update({ hosts: [host("h1")] });
    asked(w, {
      "hooks.status": { status: "absent" },
      "github.status": { installed: true, loggedIn: false },
    });
    await w.store.refreshSetup("h1");
    expect(w.store.getState().setupProbes.h1).toEqual({ hooks: "absent", github: false });
    asked(w, {});
    await w.store.refreshSetup("h1");
    expect(w.store.getState().setupProbes.h1).toEqual({ hooks: null, github: null });
  });

  test("a host that does not announce a feature is not asked about it", async () => {
    const w = make();
    (w.store as unknown as { update(p: object): void }).update({
      hosts: [host("h1", { hostInfo: { daemonVersion: "x", features: [] } })],
    });
    const calls = asked(w, {});
    await w.store.refreshSetup("h1");
    expect(calls).toEqual([]);
  });

  test("a host that is not online is not asked, and removing a host drops its answers", async () => {
    const w = make();
    const internals = w.store as unknown as { update(p: object): void };
    internals.update({ hosts: [host("h1", { status: "offline" })] });
    const calls = asked(w, { "hooks.status": { status: "installed" } });
    await w.store.refreshSetup("h1");
    expect(calls).toEqual([]);
    internals.update({
      hosts: [host("h1")],
      setupProbes: { h1: { hooks: "installed", github: null } },
    });
    await w.store.removeHost("h1");
    expect(w.store.getState().setupProbes).toEqual({});
  });
});
