import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, uiIdle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { SessionsHub } = await import("../src/ui/SessionsHub.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

type Store = InstanceType<typeof AppStore>;

const host = (id: string) => ({
  id,
  name: id,
  url: "ws://x",
  token: "",
  status: "online",
  info: null,
  hostInfo: null,
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
});

const history = (host: string, n: number, project: string) => ({
  claudeSessionId: `${host}-c${n}`,
  cwd: `/work/${project}`,
  projectKey: `host:${host}:/work/${project}`,
  title: `antiga ${project} ${n}`,
  summary: null,
  lastTs: new Date(1_700_000_000_000 + n * 1000).toISOString(),
  firstTs: null,
  messageCount: 3,
});

/** Two online hosts: `api` has one live terminal session and three old ones; `docs` only old ones. */
function setup() {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 600_000 });
  const pushed: unknown[] = [];
  store.router.push = ((route: unknown) => void pushed.push(route)) as never;
  const state = {
    ...store.getState(),
    hosts: [host("alfa"), host("beta")],
    externals: {
      "alfa/e1": {
        claudeSessionId: "e1",
        cwd: "/work/api",
        projectKey: "host:alfa:/work/api",
        status: "running",
        controllable: false,
        lastEventAt: new Date(1_700_000_100_000).toISOString(),
        summary: null,
        persona: null,
      },
    },
    hub: {
      alfa: { managed: [], history: [1, 2, 3].map((n) => history("alfa", n, "api")) },
      beta: { managed: [], history: [1, 2].map((n) => history("beta", n, "docs")) },
    },
  };
  const view = () => (
    <TooltipProvider>
      <SessionsHub
        store={store}
        state={state as never}
        onOpen={() => {}}
        isOpen={() => false}
        density="comfortable"
      />
    </TooltipProvider>
  );
  render(view());
  return { store, pushed };
}

const titles = () =>
  [...document.querySelectorAll("li[aria-label]")].map((li) => li.getAttribute("aria-label"));
const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el);
  });
  await uiIdle();
};

describe("sessoes-projetos-ui: the Sessions page is project first (issue #111)", () => {
  test("a project with a live session shows it, and its three old ones sit behind a count", async () => {
    setup();
    await settle(() => titles().length > 0);
    expect(titles()).toEqual(["api"]);
    const more = screen.getByRole("button", { name: "3 sessões anteriores" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await click(more);
    expect(titles()).toHaveLength(4);
    expect(
      screen.getByRole("button", { name: "3 sessões anteriores" }).getAttribute("aria-expanded"),
    ).toBe("true");
  });

  test("a project with nothing live starts folded; its header opens it, and folds it again", async () => {
    setup();
    await settle(() => titles().length > 0);
    const toggle = () => screen.getByRole("button", { name: "Mostrar ou esconder docs" });
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("antiga docs 1")).toBeNull();
    await click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "2 sessões anteriores" })).toBeTruthy();
    await click(toggle());
    expect(screen.queryByRole("button", { name: "2 sessões anteriores" })).toBeNull();
  });

  test("the header says how many are live, and typing a project's name opens its history", async () => {
    setup();
    await settle(() => titles().length > 0);
    const header = screen.getByRole("region", { name: "Projeto api" });
    expect(within(header).getByText("1 ao vivo")).toBeTruthy();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Filtrar sessões"), { target: { value: "docs" } });
    });
    await settle(() => screen.queryByText("antiga docs 1") !== null);
    expect(titles()).toEqual(["antiga docs 2", "antiga docs 1"]);
  });

  test("a host chip in the header opens the host page", async () => {
    const { pushed } = setup();
    await settle(() => titles().length > 0);
    const header = screen.getByRole("region", { name: "Projeto api" });
    await click(within(header).getByRole("button", { name: "Abrir o host alfa" }));
    expect(pushed).toEqual([{ name: "host", host: "alfa" }]);
  });

  test("a row of an old session names its host as a chip too, and the chip row filters by host", async () => {
    const { pushed } = setup();
    await settle(() => titles().length > 0);
    const chips = screen.getByRole("group", { name: "Hosts" });
    const alfa = within(chips).getByRole("button", { name: "alfa" });
    const beta = within(chips).getByRole("button", { name: "beta" });
    expect([alfa.getAttribute("aria-pressed"), beta.getAttribute("aria-pressed")]).toEqual([
      "false",
      "false",
    ]);
    await click(beta);
    expect(beta.getAttribute("aria-pressed")).toBe("true");
    // Only beta's project is left.
    expect(screen.queryByRole("region", { name: "Projeto api" })).toBeNull();
    expect(screen.getByRole("region", { name: "Projeto docs" })).toBeTruthy();
    await click(beta);
    expect(screen.getByRole("region", { name: "Projeto api" })).toBeTruthy();
    expect(pushed).toEqual([]);
  });
});
