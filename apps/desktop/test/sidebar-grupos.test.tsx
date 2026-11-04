import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const ALL = ["costs", "messaging", "teams", "plugins", "personas", "snippets", "ssh"];

function setup(
  features: string[] = ALL,
  platform = memoryPlatform(false, "en").platform,
  route?: import("../src/lib/router.ts").Route,
) {
  const store = new AppStore(platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const state = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        status: "online",
        hostInfo: { daemonVersion: "x", features },
        sessions: [],
      },
    ],
  } as never as ReturnType<typeof store.getState>;
  const view = (
    collapsed = false,
    go: (route: import("../src/lib/router.ts").Route) => void = () => {},
  ) => (
    <Sidebar
      store={store}
      state={state}
      collapsed={collapsed}
      t={store.i18n.t}
      go={go}
      {...(route ? { route } : {})}
      onOpenProjectScreen={() => {}}
      onNewSession={() => {}}
      onRemoveHost={() => {}}
      onRenameHost={() => null}
      onOpenSearch={() => {}}
      onNewTab={() => {}}
      onToggleTheme={() => {}}
    />
  );
  const opened: string[] = [];
  store.openLink = ((url: string) => {
    opened.push(url);
  }) as never;
  return { store, view, platform, opened };
}

const names = (root: HTMLElement) =>
  within(root)
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");

describe("sidebar-grupos: the bar in groups by purpose", () => {
  test("Work, Automation, Observability, Library and Machines, in that order, each with its items", () => {
    const { view } = setup();
    render(view());
    const titles = ["Work", "Automation", "Observability", "Library", "Machines"];
    const groups = titles.map((name) => screen.getByRole("group", { name }) as HTMLElement);
    // In the page's order.
    for (let i = 1; i < groups.length; i++) {
      expect(
        (groups[i - 1] as HTMLElement).compareDocumentPosition(groups[i] as HTMLElement) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(groups.slice(0, 4).map((g) => names(g).slice(1))).toEqual([
      ["Home", "Open Sessions", "Needs you", "Projects", "Board"],
      ["Workflows", "Teams", "Conversations"],
      ["Costs", "History"],
      ["Personas", "Snippets", "Plugins", "Vault"],
    ]);
    for (const name of titles) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-expanded")).toBe("true");
    }
    // The old groups are gone: no Infra, and no separate Hosts heading.
    expect(screen.queryByRole("group", { name: "Infra" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hosts" })).toBeNull();
  });

  test("Machines holds the hosts with their dots and a +, then SSH (once Connections)", () => {
    const { view } = setup();
    render(view());
    const machines = screen.getByRole("group", { name: "Machines" }) as HTMLElement;
    const listed = names(machines);
    expect(listed).toContain("Add another host");
    expect(listed).toContain("Open host alfa");
    expect(listed.indexOf("Open host alfa")).toBeLessThan(listed.indexOf("SSH"));
    expect(listed.at(-1)).toBe("SSH");
    expect(screen.queryByRole("button", { name: "Connections" })).toBeNull();
    expect(within(machines).getByLabelText("alfa: online")).toBeTruthy();
  });

  test("an item the host cannot offer is not listed", () => {
    const { view } = setup([]);
    render(view());
    const work = screen.getByRole("group", { name: "Work" }) as HTMLElement;
    expect(names(work).slice(1)).toEqual([
      "Home",
      "Open Sessions",
      "Needs you",
      "Projects",
      "Board",
    ]);
    const automation = screen.getByRole("group", { name: "Automation" }) as HTMLElement;
    expect(names(automation).slice(1)).toEqual(["Workflows"]);
    expect(screen.queryByRole("button", { name: "Teams" })).toBeNull();
  });

  test("folding a group hides its items, and the choice is kept for the next start", async () => {
    const { view, platform } = setup();
    render(view());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Library" }));
    });
    expect(screen.getByRole("button", { name: "Library" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(screen.queryByRole("button", { name: "Vault" })).toBeNull();
    expect(screen.getByRole("button", { name: "Workflows" })).toBeTruthy();
    cleanup();
    const again = setup(ALL, platform);
    render(again.view());
    expect(screen.queryByRole("button", { name: "Vault" })).toBeNull();
    expect(screen.getByRole("button", { name: "Library" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Library" }));
    });
    expect(screen.getByRole("button", { name: "Vault" })).toBeTruthy();
  });

  test("folding Observability and Machines hides their items and leaves the other groups alone", async () => {
    const { view } = setup();
    render(view());
    const heading = (name: string) => screen.getByRole("button", { name });
    for (const [name, item] of [
      ["Observability", "Costs"],
      ["Machines", "SSH"],
    ] as const) {
      await act(async () => {
        fireEvent.click(heading(name));
      });
      expect(heading(name).getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("button", { name: item })).toBeNull();
    }
    expect(heading("Library").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Vault" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(heading("Observability"));
    });
    await act(async () => {
      fireEvent.click(heading("Machines"));
    });
    expect(heading("Observability").getAttribute("aria-expanded")).toBe("true");
    expect(heading("Machines").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Costs" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "SSH" })).toBeTruthy();
  });

  test("the icon rail has no headings and lists every item", () => {
    const { view } = setup();
    render(view(true));
    expect(screen.queryByRole("button", { name: "Library" })).toBeNull();
    expect(screen.getByRole("button", { name: "Vault" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "History" })).toBeTruthy();
  });

  test("the open page is marked: full contrast, aria-current, and a bar at the left", () => {
    const { view } = setup(ALL, undefined, { name: "costs" });
    render(view());
    const costs = screen.getByRole("button", { name: "Costs" });
    expect(costs.getAttribute("aria-current")).toBe("page");
    expect(costs.className).toContain("nav-active");
    expect(screen.getByRole("button", { name: "Vault" }).className).not.toContain("nav-active");
    expect(screen.getByRole("button", { name: "Vault" }).getAttribute("aria-current")).toBeNull();
  });

  test("on a host's page its row under Machines is marked like the page items, in the rail too", () => {
    const { view } = setup(ALL, undefined, { name: "host", host: "h1" });
    const { unmount } = render(view());
    const host = screen.getByRole("button", { name: "Open host alfa" });
    expect(host.getAttribute("aria-current")).toBe("page");
    expect(host.className).toContain("nav-active");
    unmount();
    render(view(true));
    expect(
      screen.getByRole("button", { name: "Open host alfa" }).getAttribute("aria-current"),
    ).toBe("page");
    cleanup();
    // On another page no host row is marked.
    const other = setup(ALL, undefined, { name: "costs" });
    render(other.view());
    expect(
      screen.getByRole("button", { name: "Open host alfa" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  test("Home is the first item of Work: it opens Home and is marked while Home is open", () => {
    const routes: unknown[] = [];
    const { view } = setup(ALL, undefined, { name: "overview" });
    const { unmount } = render(view(false, (route) => void routes.push(route)));
    const home = screen.getByRole("button", { name: "Home" });
    expect(home.getAttribute("aria-current")).toBe("page");
    expect(home.className).toContain("nav-active");
    expect(
      screen.getByRole("button", { name: "Open Sessions" }).getAttribute("aria-current"),
    ).toBeNull();
    fireEvent.click(home);
    expect(routes).toEqual([{ name: "overview" }]);
    unmount();
    const other = setup(ALL, undefined, { name: "hub" });
    render(other.view());
    expect(screen.getByRole("button", { name: "Home" }).getAttribute("aria-current")).toBeNull();
  });

  test("a chevron on what has sub-pages, Beta and New on recent features, and the Needs you count stays", () => {
    const { view } = setup();
    render(view());
    const slot = (name: string, what: string) =>
      screen.getByRole("button", { name }).querySelector(`[data-slot='${what}']`);
    expect(slot("Vault", "nav-chevron")).not.toBeNull();
    expect(slot("Costs", "nav-chevron")).toBeNull();
    expect(slot("Teams", "nav-badge")?.textContent).toBe("Beta");
    expect(slot("Conversations", "nav-badge")?.textContent).toBe("New");
    expect(slot("Board", "nav-badge")).toBeNull();
  });
});
