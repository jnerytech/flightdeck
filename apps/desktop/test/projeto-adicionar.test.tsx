import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { git } from "../../daemon/test/board-helpers.ts";
import { basename } from "../src/lib/paths.ts";
import { suggestFolders } from "../src/lib/project-suggestions.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { AddProject } = await import("../src/components/projects/add-project.tsx");
const { ProjectsPage } = await import("../src/ui/ProjectsPage.tsx");
const { BoardView } = await import("../src/ui/BoardView.tsx");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(20_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(4000);

describe("suggestFolders", () => {
  const roots = ["/r"];
  const session = (cwd: string, updatedAt: string) => ({ cwd, updatedAt });

  test("the folders of recent sessions inside the allowed folders, newest first, once each", () => {
    const sessions = [
      session("/r/a", "2026-01-01T10:00:00Z"),
      session("/r/b", "2026-01-03T10:00:00Z"),
      session("/r/a", "2026-01-02T10:00:00Z"),
      session("/elsewhere/c", "2026-01-04T10:00:00Z"),
    ];
    expect(suggestFolders(sessions, roots, [])).toEqual(["/r/b", "/r/a"]);
  });

  test("a folder that already is a project is not suggested, whatever the case or slash", () => {
    const sessions = [
      session("C:\\Work\\A", "2026-01-01T10:00:00Z"),
      session("C:\\Work\\B", "2026-01-01T09:00:00Z"),
    ];
    expect(suggestFolders(sessions, ["c:/work"], [{ path: "c:/work/a" }])).toEqual(["C:\\Work\\B"]);
  });

  test("at most five", () => {
    const sessions = Array.from({ length: 8 }, (_, i) =>
      session(`/r/p${i}`, `2026-01-0${i + 1}T00:00:00Z`),
    );
    expect(suggestFolders(sessions, roots, [])).toHaveLength(5);
  });
});

async function online() {
  const d = makeDaemon(cleanups);
  const mem = memoryPlatform(false, "en-US");
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  store.i18n.start();
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  /** A git repository inside the host's allowed folder, with a session that ran in it. */
  const repo = join(d.root, "work");
  git(d.root, "init", "-q", "-b", "main", "work");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "commit", "-q", "--allow-empty", "-m", "first");
  await d.manager.create({ cwd: repo, prompt: "hi" });
  await settle(() => (store.getState().hosts[0]?.sessions.length ?? 0) > 0);
  return { d, store, hostId, repo };
}

const withT = (store: InstanceType<typeof AppStore>, node: React.ReactNode) => (
  <TContext.Provider value={store.i18n.t}>{node}</TContext.Provider>
);

const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    fireEvent.click(el as HTMLElement);
  });
};

describe("projeto-adicionar: one add-project flow", () => {
  test("it offers the folders of the host's recent sessions and adds the one picked", async () => {
    const { store, hostId, repo } = await online();
    const added: string[] = [];
    render(
      withT(
        store,
        <AddProject store={store} hostId={hostId} onAdded={(p) => added.push(p.path)} />,
      ),
    );
    await click(screen.getByRole("button", { name: "Add project" }));
    const dialog = screen.getByRole("dialog");
    await click(within(dialog).getByRole("button", { name: repo }));
    await settle(() => added.length === 1);
    expect(added[0]).toBe(repo);
    expect(store.getState().projects[hostId]?.map((p) => p.path)).toEqual([repo]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a typed folder is added with the Add button, which waits for a folder", async () => {
    const { store, hostId, repo } = await online();
    const added: string[] = [];
    render(
      withT(
        store,
        <AddProject store={store} hostId={hostId} onAdded={(p) => added.push(p.path)} />,
      ),
    );
    await click(screen.getByRole("button", { name: "Add project" }));
    const dialog = screen.getByRole("dialog");
    const add = within(dialog).getByRole("button", { name: "Add" });
    expect(add.hasAttribute("disabled") || add.getAttribute("aria-disabled") === "true").toBe(true);
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText("Project folder"), {
        target: { value: repo },
      });
    });
    await click(within(dialog).getByRole("button", { name: "Add" }));
    await settle(() => added.length === 1);
  });

  test("Browse… fills the folder from the picker, and closing the picker keeps what was typed", async () => {
    const { d, store, hostId } = await online();
    render(withT(store, <AddProject store={store} hostId={hostId} onAdded={() => {}} />));
    await click(screen.getByRole("button", { name: "Add project" }));
    await settle(() => screen.queryByRole("button", { name: "Browse…" }) !== null);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Project folder"), { target: { value: "typed" } });
    });
    await click(screen.getByRole("button", { name: "Browse…" }));
    const picker = () => screen.queryByRole("dialog", { name: "Choose folder" });
    await settle(() => picker() !== null);
    await act(async () => {
      fireEvent.keyDown(picker() as HTMLElement, { key: "Escape" });
    });
    await settle(() => picker() === null);
    expect((screen.getByLabelText("Project folder") as HTMLInputElement).value).toBe("typed");
    await click(screen.getByRole("button", { name: "Browse…" }));
    await settle(() => picker() !== null);
    const root = basename(d.root);
    const inPicker = (name: string | RegExp) =>
      within(picker() as HTMLElement).queryByRole("button", { name });
    await settle(() => inPicker(root) !== null);
    await click(inPicker(root));
    await settle(
      () =>
        within(picker() as HTMLElement).queryByRole("button", { name: "Choose this folder" }) !==
        null,
    );
    await click(
      within(picker() as HTMLElement).getByRole("button", { name: "Choose this folder" }),
    );
    await settle(() => picker() === null);
    expect((screen.getByLabelText("Project folder") as HTMLInputElement).value).toBe(d.root);
  });
});

describe("projeto-adicionar: where it is offered", () => {
  test("the Board and Workflows pickers with no project have the action in their empty state", async () => {
    const { store, hostId } = await online();
    for (const focus of ["board", "workflows"] as const) {
      const view = render(
        withT(
          store,
          <ProjectsPage
            store={store}
            hostId={hostId}
            hostName="alfa"
            focus={focus}
            onOpenBoard={() => {}}
            onOpenWorkflows={() => {}}
            automations={false}
            onOpenAutomations={() => {}}
            actions={false}
            onOpenActions={() => {}}
            rules={false}
            agent={false}
            onOpenAgent={() => {}}
          />,
        ),
      );
      await settle(() => screen.queryByText("No projects yet.") !== null);
      expect(screen.queryByRole("button", { name: "Add project" })).not.toBeNull();
      view.unmount();
    }
  });

  test("with projects the picker still has it, and the one added appears in the list", async () => {
    const { store, hostId, repo } = await online();
    await act(async () => {
      await store.hostCommand(hostId, "project.add", { path: repo });
    });
    render(
      withT(
        store,
        <ProjectsPage
          store={store}
          hostId={hostId}
          hostName="alfa"
          focus="board"
          onOpenBoard={() => {}}
          onOpenWorkflows={() => {}}
          automations={false}
          onOpenAutomations={() => {}}
          actions={false}
          onOpenActions={() => {}}
          rules={false}
          agent={false}
          onOpenAgent={() => {}}
        />,
      ),
    );
    await settle(() => screen.queryByRole("button", { name: /Open the board of/ }) !== null);
    await settle(() => screen.queryByRole("button", { name: "Add project" }) !== null);
  });

  test("a board with projects has a visible Add project button", async () => {
    const { store, hostId, repo } = await online();
    let projectId = "";
    await act(async () => {
      projectId = (await store.hostCommand(hostId, "project.add", { path: repo }))?.id ?? "";
    });
    render(
      withT(
        store,
        <BoardView store={store} hostId={hostId} projectId={projectId} onOpenCard={() => {}} />,
      ),
    );
    await settle(() => screen.queryByRole("button", { name: "Add project" }) !== null);
  });

  test("Cancel and Escape close the dialog without adding anything", async () => {
    const { store, hostId } = await online();
    render(withT(store, <AddProject store={store} hostId={hostId} onAdded={() => {}} />));
    await click(screen.getByRole("button", { name: "Add project" }));
    await click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await settle(() => screen.queryByRole("dialog") === null);
    await click(screen.getByRole("button", { name: "Add project" }));
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    });
    await settle(() => screen.queryByRole("dialog") === null);
    expect(store.getState().projects[hostId] ?? []).toEqual([]);
  });

  /** Adds a typed folder through the Add project dialog. */
  async function addTyped(folder: string) {
    await click(screen.getByRole("button", { name: "Add project" }));
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.change(within(dialog).getByLabelText("Project folder"), {
        target: { value: folder },
      });
    });
    await click(within(dialog).getByRole("button", { name: "Add" }));
  }

  const projectsPage = (store: InstanceType<typeof AppStore>, hostId: string) =>
    withT(
      store,
      <ProjectsPage
        store={store}
        hostId={hostId}
        hostName="alfa"
        focus="board"
        onOpenBoard={() => {}}
        onOpenWorkflows={() => {}}
        automations={false}
        onOpenAutomations={() => {}}
        actions={false}
        onOpenActions={() => {}}
        rules={false}
        agent={false}
        onOpenAgent={() => {}}
      />,
    );

  test("a project added from the empty picker, or beside the others, shows up in its list", async () => {
    const { d, store, hostId, repo } = await online();
    render(projectsPage(store, hostId));
    await settle(() => screen.queryByText("No projects yet.") !== null);
    await addTyped(repo);
    await settle(() => screen.queryByRole("button", { name: /Open the board of/ }) !== null);
    const second = join(d.root, "second");
    git(d.root, "init", "-q", "-b", "main", "second");
    git(second, "config", "commit.gpgsign", "false");
    git(second, "commit", "-q", "--allow-empty", "-m", "first");
    await addTyped(second);
    await settle(() => screen.queryAllByRole("button", { name: /Open the board of/ }).length === 2);
  });

  test("a project added from a board opens its board", async () => {
    const { d, store, hostId, repo } = await online();
    render(<App store={store} />);
    let projectId = "";
    await act(async () => {
      projectId = (await store.hostCommand(hostId, "project.add", { path: repo }))?.id ?? "";
    });
    const second = join(d.root, "second");
    git(d.root, "init", "-q", "-b", "main", "second");
    git(second, "config", "commit.gpgsign", "false");
    git(second, "commit", "-q", "--allow-empty", "-m", "first");
    await act(async () => store.router.push({ name: "board", host: hostId, projectId }));
    await settle(() => screen.queryByRole("button", { name: "Add project" }) !== null);
    await addTyped(second);
    await settle(() => {
      const route = store.router.current;
      return route.name === "board" && route.projectId !== projectId;
    });
  });
});
