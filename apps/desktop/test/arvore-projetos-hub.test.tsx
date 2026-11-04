import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, uiIdle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { SessionsHub } = await import("../src/ui/SessionsHub.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const external = (id: string, cwd: string) => ({
  claudeSessionId: id,
  cwd,
  projectKey: `host:alfa:${cwd}`,
  status: "idle",
  controllable: false,
  lastEventAt: "2026-11-03T10:00:00.000Z",
  summary: null,
  persona: null,
});

function setup(filter: unknown) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 600_000 });
  const cleared: unknown[] = [];
  store.setWorktreeFilter = ((f: unknown) => void cleared.push(f)) as never;
  const state = {
    ...store.getState(),
    hosts: [
      {
        id: "alfa",
        name: "alfa",
        url: "ws://x",
        token: "",
        status: "online",
        info: null,
        hostInfo: null,
        incompatibility: null,
        daemonUpdate: null,
        sessions: [],
      },
    ],
    projects: { alfa: [{ id: "p-api", name: "api", path: "/work/api", baseBranch: "main" }] },
    cards: {
      "alfa/c1": { id: "c1", projectId: "p-api", worktreePath: "/wt/login", branch: "fd/login" },
    },
    externals: {
      "alfa/main": external("main", "/work/api/src"),
      "alfa/login": external("login", "/wt/login/src"),
      "alfa/other": external("other", "/work/other"),
    },
    worktreeFilter: filter,
  };
  render(
    <TooltipProvider>
      <SessionsHub
        store={store}
        state={state as never}
        onOpen={() => {}}
        isOpen={() => false}
        density="comfortable"
      />
    </TooltipProvider>,
  );
  return { cleared };
}

const titles = () =>
  [...document.querySelectorAll("li[aria-label]")].map((li) => li.getAttribute("aria-label"));
const base = { hostId: "alfa", projectId: "p-api" };

describe("arvore-projetos-hub: the Sessions list narrows to a picked branch (issue #116)", () => {
  test("a worktree keeps the sessions inside it, with a chip that names the branch", async () => {
    setup({ ...base, kind: "worktree", path: "/wt/login", branch: "fd/login" });
    await settle(() => titles().length > 0);
    expect(titles()).toEqual(["src"]);
    expect(screen.getByText("Branch: fd/login")).toBeTruthy();
  });

  test("the main checkout keeps the sessions in the project's folder outside every worktree", async () => {
    setup({ ...base, kind: "primary", path: "/work/api", branch: "main" });
    await settle(() => titles().length > 0);
    expect(titles()).toEqual(["src"]);
    expect(screen.getByText("Branch: main")).toBeTruthy();
  });

  test("the chip clears the filter, and with none every session is listed", async () => {
    const { cleared } = setup({ ...base, kind: "worktree", path: "/wt/login", branch: "fd/login" });
    await settle(() => titles().length > 0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Limpar o filtro de branch" }));
    });
    await uiIdle();
    expect(cleared).toEqual([null]);
    cleanup();
    setup(null);
    await settle(() => titles().length > 0);
    expect(titles()).toHaveLength(3);
    expect(screen.queryByText(/^Branch:/)).toBeNull();
  });
});
