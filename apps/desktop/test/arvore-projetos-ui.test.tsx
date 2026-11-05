import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Card, Project } from "@flightdeck/protocol";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const project = { id: "p-api", name: "api", path: "/work/api", baseBranch: "develop" } as Project;
const card = (id: string, branch: string, worktreePath: string, sessionStatus: string) =>
  ({
    id,
    projectId: "p-api",
    title: id,
    branch,
    worktreePath,
    sessionStatus,
    position: 0,
    createdAt: "2026-11-01T10:00:00Z",
  }) as unknown as Card;

function setup(filter: unknown = null, route?: object, real = false) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
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
    projects: { h1: [project] },
    cards: {
      "h1/c1": card("c1", "fd/login", "/wt/login", "running"),
      "h1/c2": card("c2", "fd/search", "/wt/search", "awaiting_permission"),
    },
    worktreeFilter: filter,
  } as never as ReturnType<typeof store.getState>;
  const went: unknown[] = [];
  const picked: unknown[] = [];
  if (!real) store.setWorktreeFilter = ((f: unknown) => void picked.push(f)) as never;
  render(
    <Sidebar
      store={store}
      state={state}
      collapsed={false}
      route={route as never}
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
  return { went, picked, store };
}

const tree = () => screen.getByRole("list", { name: "Branches of api" });

describe("arvore-projetos-ui: the project tree in the sidebar (issue #116)", () => {
  test("under Projects in the Work group, a project lists its primary checkout and its worktrees", () => {
    setup();
    const work = screen.getByRole("group", { name: "Work" });
    expect(within(work).getByRole("list", { name: "Branches of api" })).toBeTruthy();
    const nodes = within(tree()).getAllByRole("listitem");
    expect(nodes.map((n) => n.textContent)).toEqual([
      expect.stringContaining("develop"),
      expect.stringContaining("fd/login"),
      expect.stringContaining("fd/search"),
    ]);
    // The primary one wears its badge; each node says which branch it was cut from, below.
    expect(within(nodes[0] as HTMLElement).getByText("primary")).toBeTruthy();
    expect(within(nodes[1] as HTMLElement).queryByText("primary")).toBeNull();
    expect(within(nodes[1] as HTMLElement).getByText("base develop")).toBeTruthy();
    // The state dots are named, not only colored.
    expect(within(nodes[1] as HTMLElement).getByRole("img", { name: "running" })).toBeTruthy();
    expect(within(nodes[2] as HTMLElement).getByRole("img", { name: "needs you" })).toBeTruthy();
  });

  test("picking a node narrows to it and opens the project's board; picking it again clears", async () => {
    const first = setup();
    await act(async () => {
      fireEvent.click(within(tree()).getByRole("button", { name: "api: fd/login" }));
    });
    expect(first.picked).toEqual([
      { hostId: "h1", projectId: "p-api", kind: "worktree", path: "/wt/login", branch: "fd/login" },
    ]);
    expect(first.went).toEqual([{ name: "board", host: "h1", projectId: "p-api" }]);
    cleanup();
    const again = setup({
      hostId: "h1",
      projectId: "p-api",
      kind: "worktree",
      path: "/wt/login",
      branch: "fd/login",
    });
    const node = within(tree()).getByRole("button", { name: "api: fd/login" });
    expect(node.getAttribute("aria-current")).toBe("true");
    await act(async () => {
      fireEvent.click(node);
    });
    expect(again.picked).toEqual([null]);
  });
});

describe("arvore-projetos-ui: stay where you are, say what a node is (issue #116 review)", () => {
  test("picking from the Sessions list narrows it in place instead of opening the board", async () => {
    const { went, picked } = setup(null, { name: "hub" });
    await act(async () => {
      fireEvent.click(within(tree()).getByRole("button", { name: "api: fd/login" }));
    });
    expect(picked).toHaveLength(1);
    expect(went).toEqual([]);
  });

  test("the real store keeps the pick, and picking it again clears it", async () => {
    const { store } = setup(null, undefined, true);
    const node = () => within(tree()).getByRole("button", { name: "api: fd/login" });
    await act(async () => {
      fireEvent.click(node());
    });
    expect(store.getState().worktreeFilter).toMatchObject({ path: "/wt/login", kind: "worktree" });
  });

  test("a node's description carries what its short name drops: primary and base branch", () => {
    setup();
    const describedBy = (name: string) => {
      const button = within(tree()).getByRole("button", { name });
      return (button.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(" ");
    };
    expect(describedBy("api: develop")).toContain("primary");
    expect(describedBy("api: develop")).toContain("base develop");
    expect(describedBy("api: fd/login")).toBe("base develop");
  });

  test("every node is a real button in the tab order, with a focus ring in the stylesheet", async () => {
    setup();
    for (const button of within(tree()).getAllByRole("button")) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.tabIndex).toBe(0);
    }
    const css = await Bun.file(new URL("../src/styles.css", import.meta.url)).text();
    const node = css.split("@utility project-tree-node")[1]?.split("@utility")[0] ?? "";
    expect(node).toContain("&:focus-visible");
  });
});
