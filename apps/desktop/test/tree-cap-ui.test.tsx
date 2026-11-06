import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { StateTone } from "../src/components/status/status-dot.tsx";
import type { TreeProject, WorktreeFilter } from "../src/lib/project-tree.ts";
import type { Route } from "../src/lib/router.ts";
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

/** A project with one checkout; `at` is when it last changed, so a larger one is more recent. */
const project = (name: string, at = 0, tone: StateTone = "idle"): TreeProject => ({
  hostId: "h1",
  projectId: `p-${name}`,
  name,
  path: `/work/${name}`,
  lastActivityAt: at,
  nodes: [
    {
      key: `h1/p-${name}/primary`,
      kind: "primary",
      branch: "main",
      base: "main",
      path: `/work/${name}`,
      tone,
      cardId: null,
    },
  ],
});
/** Eight projects, `a` the oldest and `h` the newest. */
const EIGHT = "abcdefgh".split("").map((name, i) => project(name, (i + 1) * 1000));

function setup(
  tree: TreeProject[],
  options: { language?: "en" | "pt-BR"; filter?: WorktreeFilter | null } = {},
) {
  const mem = memoryPlatform(false, options.language ?? "en");
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const went: Route[] = [];
  const view = (current: InstanceType<typeof AppStore> = store) => (
    <TContext.Provider value={current.i18n.t}>
      <ProjectTree
        store={current}
        tree={tree}
        filter={options.filter ?? null}
        t={current.i18n.t}
        go={(route) => void went.push(route)}
      />
    </TContext.Provider>
  );
  return { store, mem, went, view };
}

/** The names of the projects on the tree, top to bottom. */
const projectsOnTree = () =>
  [...document.querySelectorAll(".project-tree-name")].map((el) => el.textContent ?? "");
const nameButton = (name: string) =>
  document.querySelector<HTMLElement>(`.project-tree-name[data-project="${name}"]`);
const has = (node: unknown) => node !== null && node !== undefined;
const click = (el: Element | null) =>
  act(async () => {
    expect(has(el), "the control to click").toBe(true);
    fireEvent.click(el as Element);
  });
const link = (name: string) => screen.queryByRole("button", { name });
const expanded = (name: string) => nameButton(name)?.getAttribute("aria-expanded");

describe("tree-cap-ui: the tree shows a few projects (issue #689)", () => {
  test("eight projects: the five most recent, newest first, and a link to all of them", async () => {
    const w = setup(EIGHT);
    render(w.view());
    expect(projectsOnTree()).toEqual(["h", "g", "f", "e", "d"]);
    await click(link("All projects (8)"));
    expect(w.went).toEqual([{ name: "all-projects" }]);
  });

  test("five projects or fewer: all of them, no link and no filter field", () => {
    render(setup(EIGHT.slice(0, 5)).view());
    expect(projectsOnTree()).toHaveLength(5);
    expect(has(link("All projects (5)"))).toBe(false);
    expect(has(screen.queryByRole("searchbox", { name: "Filter projects" }))).toBe(false);
  });

  test("the project of the picked checkout is always there, past the five", () => {
    const filter: WorktreeFilter = {
      hostId: "h1",
      projectId: "p-a",
      kind: "primary",
      path: "/work/a",
      branch: "main",
    };
    render(setup(EIGHT, { filter }).view());
    expect(projectsOnTree()).toEqual(["h", "g", "f", "e", "d", "a"]);
  });

  test("a pin moves a project to the top, is kept across starts, and unpins", async () => {
    const w = setup(EIGHT);
    render(w.view());
    const pin = screen.queryByRole("button", { name: "Pin a" });
    expect(pin?.getAttribute("aria-pressed")).toBe("false");
    // `a` is not on the tree yet: filter to reach it, then pin.
    await act(async () => {
      fireEvent.change(screen.getByRole("searchbox", { name: "Filter projects" }), {
        target: { value: "a" },
      });
    });
    await click(screen.queryByRole("button", { name: "Pin a" }));
    expect(w.store.treePinned()).toEqual(["h1/p-a"]);
    cleanup();
    const again = new AppStore(w.mem.platform, { baseDelayMs: 600_000 });
    again.i18n.start();
    render(w.view(again));
    expect(projectsOnTree()[0]).toBe("a");
    expect(screen.queryByRole("button", { name: "Unpin a" })?.getAttribute("aria-pressed")).toBe(
      "true",
    );
    await click(screen.queryByRole("button", { name: "Unpin a" }));
    expect(again.treePinned()).toEqual([]);
    expect(projectsOnTree()).toEqual(["h", "g", "f", "e", "d"]);
  });
});

describe("tree-cap-ui: the filter field (issue #689)", () => {
  const field = () => screen.queryByRole("searchbox", { name: "Filter projects" });
  const type = (value: string) =>
    act(async () => {
      expect(has(field()), "the filter field").toBe(true);
      fireEvent.change(field() as HTMLElement, { target: { value } });
    });

  test("past five projects a field narrows the list by name, to every match", async () => {
    const tree = ["api", "apps", "apiary", "web", "docs", "tools", "zeta"].map((n, i) =>
      project(n, i),
    );
    render(setup(tree).view());
    expect(has(field())).toBe(true);
    await type("AP");
    expect(projectsOnTree()).toEqual(["apiary", "apps", "api"]);
    await type("nothing like it");
    expect(projectsOnTree()).toEqual([]);
    expect(has(screen.queryByText("No project matches"))).toBe(true);
  });

  test("Escape clears it", async () => {
    render(setup(EIGHT).view());
    await type("a");
    expect(projectsOnTree()).toEqual(["a"]);
    await act(async () => {
      fireEvent.keyDown(field() as HTMLElement, { key: "Escape" });
    });
    expect((field() as HTMLInputElement | null)?.value).toBe("");
    expect(projectsOnTree()).toEqual(["h", "g", "f", "e", "d"]);
  });
});

describe("tree-cap-ui: the fold at the start (issue #689)", () => {
  const filter = (name: string): WorktreeFilter => ({
    hostId: "h1",
    projectId: `p-${name}`,
    kind: "primary",
    path: `/work/${name}`,
    branch: "main",
  });

  test("three projects: all open; four: all but the active one start folded", () => {
    render(setup(EIGHT.slice(0, 3)).view());
    expect(["a", "b", "c"].map(expanded)).toEqual(["true", "true", "true"]);
    cleanup();
    render(setup(EIGHT.slice(0, 4), { filter: filter("b") }).view());
    expect(["a", "b", "c", "d"].map(expanded)).toEqual(["false", "true", "false", "false"]);
  });

  test("opening a folded project is kept, and survives a restart", async () => {
    const w = setup(EIGHT.slice(0, 4));
    render(w.view());
    expect(expanded("d")).toBe("false");
    await click(nameButton("d"));
    expect(expanded("d")).toBe("true");
    expect(w.store.treeOpened()).toEqual(["h1/p-d"]);
    cleanup();
    const again = new AppStore(w.mem.platform, { baseDelayMs: 600_000 });
    again.i18n.start();
    render(w.view(again));
    expect(expanded("d")).toBe("true");
    expect(expanded("c")).toBe("false");
    // Folding it again is a choice too.
    await click(nameButton("d"));
    expect(expanded("d")).toBe("false");
    expect(again.treeOpened()).toEqual([]);
  });

  test("a folded project with a needs-you or a running session shows a dot, an idle one does not", async () => {
    const tree = [
      project("a", 4, "needs-you"),
      project("b", 3, "running"),
      project("c", 2, "idle"),
      project("d", 1, "idle"),
    ];
    render(setup(tree).view());
    const dot = (name: string, label: string) => {
      const button = nameButton(name);
      return button !== null && has(within(button).queryByRole("img", { name: label }));
    };
    expect([
      dot("a", "needs you"),
      dot("b", "running"),
      dot("c", "idle"),
      dot("d", "idle"),
    ]).toEqual([true, true, false, false]);
    await click(nameButton("a"));
    expect(dot("a", "needs you")).toBe(false);
  });
});

describe("tree-cap-ui: it reads in Portuguese (issue #689)", () => {
  test("the link, the field and the pin", () => {
    render(setup(EIGHT, { language: "pt-BR" }).view());
    expect(has(link("Todos os projetos (8)"))).toBe(true);
    expect(has(screen.queryByRole("searchbox", { name: "Filtrar projetos" }))).toBe(true);
    expect(has(screen.queryByRole("button", { name: "Fixar h" }))).toBe(true);
  });
});
