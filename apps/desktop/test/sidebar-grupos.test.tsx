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

function setup(features: string[] = ALL, platform = memoryPlatform(false, "en").platform) {
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
  const view = (collapsed = false) => (
    <Sidebar
      store={store}
      state={state}
      collapsed={collapsed}
      t={store.i18n.t}
      go={() => {}}
      onOpenProjectScreen={() => {}}
      onNewSession={() => {}}
      onRemoveHost={() => {}}
      onRenameHost={() => null}
      onOpenSearch={() => {}}
      onNewTab={() => {}}
      onToggleTheme={() => {}}
    />
  );
  return { store, view, platform };
}

const names = (root: HTMLElement) =>
  within(root)
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");

describe("sidebar-grupos: the bar in groups", () => {
  test("Sessions, Needs you, Projects and Board stay on top, outside any group", () => {
    const { view } = setup();
    render(view());
    const top = screen.getByRole("navigation", { name: "Main" });
    expect(names(top).slice(0, 4)).toEqual(["Open Sessions", "Needs you", "Projects", "Board"]);
  });

  test("Work, Library and Infra group the rest, each with its items", () => {
    const { view } = setup();
    render(view());
    const groups = ["Work", "Library", "Infra"].map(
      (name) => screen.getByRole("group", { name }) as HTMLElement,
    );
    expect(groups.map((g) => names(g).slice(1))).toEqual([
      ["Workflows", "Costs", "Conversations", "Teams"],
      ["Personas", "Snippets", "Plugins", "Vault"],
      ["Connections", "History"],
    ]);
    for (const name of ["Work", "Library", "Infra"]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-expanded")).toBe("true");
    }
  });

  test("an item the host cannot offer is not listed", () => {
    const { view } = setup([]);
    render(view());
    const work = screen.getByRole("group", { name: "Work" }) as HTMLElement;
    expect(names(work).slice(1)).toEqual(["Workflows"]);
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

  test("folding Work and Infra hides their items and leaves the other groups alone", async () => {
    const { view } = setup();
    render(view());
    const heading = (name: string) => screen.getByRole("button", { name });
    for (const [name, item] of [
      ["Work", "Costs"],
      ["Infra", "Connections"],
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
      fireEvent.click(heading("Work"));
    });
    await act(async () => {
      fireEvent.click(heading("Infra"));
    });
    expect(heading("Work").getAttribute("aria-expanded")).toBe("true");
    expect(heading("Infra").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Costs" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connections" })).toBeTruthy();
  });

  test("the icon rail has no headings and lists every item", () => {
    const { view } = setup();
    render(view(true));
    expect(screen.queryByRole("button", { name: "Library" })).toBeNull();
    expect(screen.getByRole("button", { name: "Vault" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "History" })).toBeTruthy();
  });
});
