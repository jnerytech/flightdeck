import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { git } from "../../daemon/test/board-helpers.ts";
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
  const repo = `${d.root}/work`;
  git(d.root, "init", "-q", "-b", "main", "work");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "commit", "-q", "--allow-empty", "-m", "first");
  d.manager.create({ cwd: repo, prompt: "hi" });
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
    await settle(() => screen.queryByRole("button", { name: /Open board of/ }) !== null);
    expect(screen.queryByRole("button", { name: "Add project" })).not.toBeNull();
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
});
