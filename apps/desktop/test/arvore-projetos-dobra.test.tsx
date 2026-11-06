import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { TreeNode, TreeProject } from "../src/lib/project-tree.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { ProjectTree } = await import("../src/components/projects/project-tree.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const node = (n: number): TreeNode => ({
  key: `h1/p-api/wt${n}`,
  kind: n === 0 ? "primary" : "worktree",
  branch: n === 0 ? "main" : `fd/work-${n}`,
  base: "main",
  path: n === 0 ? "/work/api" : `/wt/${n}`,
  tone: "idle",
  cardId: n === 0 ? null : `c${n}`,
});
const project = (count: number, id = "p-api", name = "api"): TreeProject => ({
  hostId: "h1",
  projectId: id,
  name,
  path: `/work/${name}`,
  nodes: Array.from({ length: count }, (_, i) => node(i)),
});

function setup(
  tree: TreeProject[],
  options: { folded?: string[]; filter?: Parameters<typeof ProjectTree>[0]["filter"] } = {},
) {
  const mem = memoryPlatform(false, "en");
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  if (options.folded) store.setTreeFolded(options.folded);
  const view = () => (
    <TContext.Provider value={store.i18n.t}>
      <ProjectTree
        store={store}
        tree={tree}
        filter={options.filter ?? null}
        t={store.i18n.t}
        go={() => {}}
      />
    </TContext.Provider>
  );
  return { store, mem, view };
}

const items = () =>
  screen
    .queryAllByRole("listitem")
    .map((li) => li.querySelector("button")?.getAttribute("aria-label") ?? "")
    .filter(Boolean);
const toggle = (name = "api") => screen.getByRole("button", { name: new RegExp(`^${name}(?!:)`) });
const click = (el: Element) =>
  act(async () => {
    fireEvent.click(el);
  });

describe("arvore-projetos-dobra: a project with many worktrees (issue #215)", () => {
  test("only the first 8 checkouts show, and the rest are one button away", async () => {
    render(setup([project(12)]).view());
    expect(items()).toHaveLength(8);
    const more = screen.getByRole("button", { name: "4 more" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await click(more);
    expect(items()).toHaveLength(12);
    const fewer = screen.getByRole("button", { name: "Show fewer" });
    expect(fewer.getAttribute("aria-expanded")).toBe("true");
    await click(fewer);
    expect(items()).toHaveLength(8);
  });

  test("a project with 8 or fewer has no such button", () => {
    render(setup([project(8)]).view());
    expect(items()).toHaveLength(8);
    expect(screen.queryByRole("button", { name: /more|fewer/ })).toBeNull();
  });

  test("the checkout that is picked stays in view even past the cap", () => {
    const filter = {
      hostId: "h1",
      projectId: "p-api",
      kind: "worktree" as const,
      path: "/wt/10",
      branch: "fd/work-10",
    };
    render(setup([project(12)], { filter }).view());
    const names = items();
    expect(names).toHaveLength(9);
    expect(names).toContain("api: fd/work-10");
    expect(screen.getByRole("button", { name: "3 more" })).toBeTruthy();
  });

  test("the project's name folds its list, the fold is kept, and it comes back after a restart", async () => {
    const first = setup([project(3)]);
    render(first.view());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    await click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(items()).toHaveLength(0);
    cleanup();
    // A new store on the same storage: the fold is still there.
    const again = new AppStore(first.mem.platform, { baseDelayMs: 600_000 });
    again.i18n.start();
    expect(again.treeFolded()).toEqual(["h1/p-api"]);
    render(
      <TContext.Provider value={again.i18n.t}>
        <ProjectTree
          store={again}
          tree={[project(3)]}
          filter={null}
          t={again.i18n.t}
          go={() => {}}
        />
      </TContext.Provider>,
    );
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(items()).toHaveLength(0);
  });

  test("each project folds on its own", async () => {
    render(setup([project(2, "p-api", "api"), project(2, "p-web", "web")]).view());
    await click(toggle("api"));
    expect(toggle("api").getAttribute("aria-expanded")).toBe("false");
    expect(toggle("web").getAttribute("aria-expanded")).toBe("true");
    expect(items()).toHaveLength(2);
  });

  test("the keyboard folds with ArrowLeft and unfolds with ArrowRight", async () => {
    render(setup([project(3)]).view());
    await act(async () => {
      fireEvent.keyDown(toggle(), { key: "ArrowLeft" });
    });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      fireEvent.keyDown(toggle(), { key: "ArrowRight" });
    });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });

  test("a folded project that holds the picked checkout says so on its name", () => {
    const filter = {
      hostId: "h1",
      projectId: "p-api",
      kind: "worktree" as const,
      path: "/wt/2",
      branch: "fd/work-2",
    };
    render(setup([project(3)], { folded: ["h1/p-api"], filter }).view());
    expect(within(toggle()).getByRole("img", { name: "Branch picked: fd/work-2" })).toBeTruthy();
  });

  test("it reads in Portuguese", () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    render(
      <TContext.Provider value={store.i18n.t}>
        <ProjectTree
          store={store}
          tree={[project(10)]}
          filter={null}
          t={store.i18n.t}
          go={() => {}}
        />
      </TContext.Provider>,
    );
    expect(screen.getByRole("button", { name: "mais 2" })).toBeTruthy();
  });
});
