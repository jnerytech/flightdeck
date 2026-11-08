import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Card, Project } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe, stays } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const project = { id: "p-api", name: "api", path: "/work/api", baseBranch: "develop" } as Project;
const card = {
  id: "c1",
  projectId: "p-api",
  title: "c1",
  branch: "fd/login",
  worktreePath: "/wt/login",
  sessionStatus: "running",
  position: 0,
  createdAt: "2026-11-01T10:00:00Z",
} as unknown as Card;

type Options = { collapsed?: boolean; projects?: Project[]; lang?: "en" | "pt-BR" };

function setup({ collapsed = true, projects = [project], lang = "en" }: Options = {}) {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const state = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        status: "online",
        hostInfo: { daemonVersion: "x", features: [] },
        sessions: [],
      },
    ],
    projects: { h1: projects },
    cards: projects.length > 0 ? { "h1/c1": card } : {},
  } as never as ReturnType<typeof store.getState>;
  const went: unknown[] = [];
  const picked: unknown[] = [];
  store.setWorktreeFilter = ((f: unknown) => void picked.push(f)) as never;
  render(
    <Sidebar
      store={store}
      state={state}
      collapsed={collapsed}
      route={undefined}
      t={store.i18n.t}
      go={(route) => void went.push(route)}
      onOpenProjectScreen={() => {}}
      onNewSession={() => {}}
      onRemoveHost={() => {}}
      onRenameHost={() => null}
      onOpenSearch={() => {}}
      onNewTab={() => {}}
      onToggleTheme={() => {}}
    />,
  );
  return { went, picked };
}

const railButton = (name: string) => screen.getByRole("button", { name }) as HTMLElement;
const flyout = (name: string) => screen.queryByRole("dialog", { name });
const open = async (name: string) => {
  await act(async () => {
    fireEvent.click(railButton(name));
  });
};
const isOpen = (name: string) => settleMaybe(() => Boolean(flyout(name)));
const isClosed = (name: string) => settleMaybe(() => flyout(name) === null);

describe("rail-flyout-ui: the Projects icon of the collapsed rail opens the project tree (#689)", () => {
  test("pressing it shows the tree and an All projects link, and does not leave the screen", async () => {
    const { went } = setup();
    const button = railButton("Projects");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await open("Projects");
    expect(await isOpen("Projects")).toBe(true);
    const panel = flyout("Projects") as HTMLElement;
    expect(within(panel).queryByRole("list", { name: "Branches of api" }) === null).toBe(false);
    expect(within(panel).queryByRole("button", { name: "All projects (1)" }) === null).toBe(false);
    expect(railButton("Projects").getAttribute("aria-expanded")).toBe("true");
    expect(went).toEqual([]);
  });

  test("picking a branch narrows to it, opens the board and closes the flyout", async () => {
    const { went, picked } = setup();
    await open("Projects");
    expect(await isOpen("Projects")).toBe(true);
    const panel = flyout("Projects") as HTMLElement;
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "api: fd/login" }));
    });
    expect(picked).toEqual([
      { hostId: "h1", projectId: "p-api", kind: "worktree", path: "/wt/login", branch: "fd/login" },
    ]);
    expect(went).toEqual([{ name: "board", host: "h1", projectId: "p-api" }]);
    expect(await isClosed("Projects")).toBe(true);
  });

  test("All projects opens the Projects page and closes the flyout", async () => {
    const { went } = setup();
    await open("Projects");
    expect(await isOpen("Projects")).toBe(true);
    await act(async () => {
      fireEvent.click(
        within(flyout("Projects") as HTMLElement).getByRole("button", { name: "All projects (1)" }),
      );
    });
    expect(went).toEqual([{ name: "all-projects" }]);
    expect(await isClosed("Projects")).toBe(true);
  });

  test("Escape closes it and the focus goes back to the Projects icon", async () => {
    setup();
    await open("Projects");
    expect(await isOpen("Projects")).toBe(true);
    await act(async () => {
      fireEvent.keyDown(flyout("Projects") as HTMLElement, { key: "Escape" });
    });
    expect(await isClosed("Projects")).toBe(true);
    expect(await settleMaybe(() => document.activeElement === railButton("Projects"))).toBe(true);
    expect(railButton("Projects").getAttribute("aria-expanded")).toBe("false");
  });

  test("pressing the icon again closes it and does not reopen it", async () => {
    setup();
    await open("Projects");
    expect(await isOpen("Projects")).toBe(true);
    // A real press is a pointer down and then a click.
    await act(async () => {
      fireEvent.pointerDown(railButton("Projects"));
      fireEvent.click(railButton("Projects"));
    });
    expect(await isClosed("Projects")).toBe(true);
    expect(railButton("Projects").getAttribute("aria-expanded")).toBe("false");
  });

  test("opened, the focus is inside the panel, on its first control", async () => {
    setup();
    await open("Projects");
    expect(await isOpen("Projects")).toBe(true);
    const panel = flyout("Projects") as HTMLElement;
    expect(await settleMaybe(() => panel.contains(document.activeElement))).toBe(true);
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });

  test("moving the focus to another control closes it and leaves the focus there", async () => {
    setup();
    await open("Projects");
    expect(await isOpen("Projects")).toBe(true);
    const board = railButton("Board");
    await act(async () => {
      board.focus();
    });
    expect(await isClosed("Projects")).toBe(true);
    // The icon does not take the focus back from where the person went.
    await stays(() => document.activeElement === board);
  });

  test("with no project to list, the icon goes straight to the Projects page", async () => {
    const { went } = setup({ projects: [] });
    expect(railButton("Projects").getAttribute("aria-haspopup")).toBeNull();
    await open("Projects");
    expect(went).toEqual([{ name: "all-projects" }]);
    expect(flyout("Projects") === null).toBe(true);
  });

  test("the expanded bar is as it was: the item goes to the Projects page and has no flyout", async () => {
    const { went } = setup({ collapsed: false });
    const item = screen.getByRole("button", { name: "Projects" });
    expect(item.getAttribute("aria-haspopup")).toBeNull();
    await act(async () => {
      fireEvent.click(item);
    });
    expect(went).toEqual([{ name: "all-projects" }]);
    expect(flyout("Projects") === null).toBe(true);
  });

  test("in Portuguese the flyout and its link are in Portuguese", async () => {
    setup({ lang: "pt-BR" });
    await open("Projetos");
    expect(await isOpen("Projetos")).toBe(true);
    const panel = flyout("Projetos") as HTMLElement;
    expect(within(panel).queryByRole("button", { name: "Todos os projetos (1)" }) === null).toBe(
      false,
    );
  });
});
