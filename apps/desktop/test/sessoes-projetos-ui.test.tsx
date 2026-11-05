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

const shared = (host: string, n: number) => ({
  ...history(host, n, "web"),
  projectKey: "github.com/acme/web",
  title: `web ${host} ${n}`,
});

/** Two online hosts: `api` has one live terminal session and three old ones; `docs` only old ones. */
function setup(
  options: { open?: Record<string, boolean>; needsYou?: boolean; twins?: boolean } = {},
) {
  const mem = memoryPlatform();
  if (options.open)
    mem.platform.storage.setItem("flightdeck.hubOpen", JSON.stringify(options.open));
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  const pushed: unknown[] = [];
  store.router.push = ((route: unknown) => void pushed.push(route)) as never;
  const state = {
    ...store.getState(),
    hosts: [host("alfa"), host("beta")],
    externals: {
      ...(options.needsYou
        ? {
            "alfa/e2": {
              claudeSessionId: "e2",
              cwd: "/work/api/pedido",
              projectKey: "host:alfa:/work/api",
              status: "awaiting_permission",
              controllable: false,
              lastEventAt: new Date(1_700_000_200_000).toISOString(),
              summary: null,
              persona: null,
            },
          }
        : {}),
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
      alfa: {
        managed: [],
        history: [
          ...[1, 2, 3].map((n) => history("alfa", n, "api")),
          shared("alfa", 1),
          history("alfa", 1, "solo"),
          ...(options.twins
            ? [
                {
                  ...history("alfa", 7, "api"),
                  cwd: "/play/api",
                  projectKey: "host:alfa:/play/api",
                  claudeSessionId: "alfa-twin",
                },
              ]
            : []),
        ],
      },
      beta: {
        managed: [],
        history: [...[1, 2].map((n) => history("beta", n, "docs")), shared("beta", 1)],
      },
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

const API = "host:alfa:/work/api";
const expandAll = () => screen.getByRole("button", { name: "Expandir tudo" });
const collapseAll = () => screen.getByRole("button", { name: "Recolher tudo" });

describe("sessoes-projetos-ui: the Sessions page is project first (issue #111)", () => {
  test("every project starts folded: a heading, a folder, a live/total chip and its host chips, no rows", async () => {
    setup();
    await settle(() => screen.queryByRole("heading", { name: "api" }) !== null);
    expect(titles()).toEqual([]);
    const region = screen.getByRole("region", { name: "Projeto api" });
    const heading = within(region).getByRole("heading", { name: "api" });
    // A real section heading: bold and larger than the muted line it was, with its folder.
    expect(heading.className).toContain("font-semibold");
    expect(heading.className).not.toContain("text-muted-foreground");
    expect(region.querySelector("svg.lucide-folder")).not.toBeNull();
    expect(within(region).getByText("1/4").getAttribute("aria-label")).toBe(
      "1 ao vivo de 4 sessões",
    );
    expect(within(region).getByRole("button", { name: "Abrir o host alfa" })).toBeTruthy();
    expect(
      within(region)
        .getByRole("button", { name: "Mostrar ou esconder api" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  test("a folded project still shows the sessions that need you", async () => {
    setup({ needsYou: true });
    await settle(() => titles().length > 0);
    expect(titles()).toEqual(["pedido"]);
    expect(screen.getByText("2/5")).toBeTruthy();
  });

  test("opening a project shows its live sessions, its old ones behind a count; folding it again hides them", async () => {
    setup();
    await settle(() => screen.queryByRole("heading", { name: "api" }) !== null);
    const toggle = () => screen.getByRole("button", { name: "Mostrar ou esconder api" });
    await click(toggle());
    expect(titles()).toEqual(["api"]);
    const more = screen.getByRole("button", { name: "3 sessões anteriores" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await click(more);
    expect(titles()).toHaveLength(4);
    await click(toggle());
    expect(titles()).toEqual([]);
  });

  test("the choice is remembered per project: what was opened comes back open", async () => {
    const first = setup();
    await settle(() => screen.queryByRole("heading", { name: "api" }) !== null);
    await click(screen.getByRole("button", { name: "Mostrar ou esconder api" }));
    expect(first.store.hubOpen()).toEqual({ [API]: true });
    cleanup();
    setup({ open: { [API]: true } });
    await settle(() => titles().length > 0);
    expect(titles()).toEqual(["api"]);
    expect(
      screen
        .getByRole("button", { name: "Mostrar ou esconder docs" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  test("Expand all opens every project, Collapse all folds them, and both are remembered", async () => {
    const { store } = setup();
    await settle(() => screen.queryByRole("heading", { name: "api" }) !== null);
    await click(expandAll());
    for (const name of ["api", "docs", "web", "solo"]) {
      expect(
        screen
          .getByRole("button", { name: `Mostrar ou esconder ${name}` })
          .getAttribute("aria-expanded"),
      ).toBe("true");
    }
    expect(Object.values(store.hubOpen()).every((open) => open)).toBe(true);
    await click(collapseAll());
    expect(titles()).toEqual([]);
    expect(Object.values(store.hubOpen()).every((open) => !open)).toBe(true);
    expect(Object.keys(store.hubOpen()).length).toBeGreaterThanOrEqual(4);
  });

  test("typing a project's name opens its history", async () => {
    setup();
    await settle(() => screen.queryByRole("heading", { name: "docs" }) !== null);
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Filtrar sessões"), { target: { value: "docs" } });
    });
    await settle(() => screen.queryByText("antiga docs 1") !== null);
    expect(titles()).toEqual(["antiga docs 2", "antiga docs 1"]);
  });

  test("a host chip in the header opens the host page", async () => {
    const { pushed } = setup();
    await settle(() => screen.queryByRole("heading", { name: "api" }) !== null);
    const header = screen.getByRole("region", { name: "Projeto api" });
    await click(within(header).getByRole("button", { name: "Abrir o host alfa" }));
    expect(pushed).toEqual([{ name: "host", host: "alfa" }]);
  });

  test("the chip row narrows the list by host without unfolding the projects it keeps (issue #241)", async () => {
    setup();
    await settle(() => screen.queryByRole("heading", { name: "docs" }) !== null);
    const chips = screen.getByRole("group", { name: "Hosts" });
    await click(within(chips).getByRole("button", { name: "beta" }));
    const docs = screen.getByRole("region", { name: "Projeto docs" });
    expect(
      within(docs)
        .getByRole("button", { name: "Mostrar ou esconder docs" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(titles()).toEqual([]);
  });

  test("the chip row filters by host", async () => {
    setup();
    await settle(() => screen.queryByRole("heading", { name: "api" }) !== null);
    const chips = screen.getByRole("group", { name: "Hosts" });
    const alfa = within(chips).getByRole("button", { name: "alfa" });
    const beta = within(chips).getByRole("button", { name: "beta" });
    expect([alfa.getAttribute("aria-pressed"), beta.getAttribute("aria-pressed")]).toEqual([
      "false",
      "false",
    ]);
    await click(beta);
    expect(beta.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("region", { name: "Projeto api" })).toBeNull();
    expect(screen.getByRole("region", { name: "Projeto docs" })).toBeTruthy();
    await click(beta);
    expect(screen.getByRole("region", { name: "Projeto api" })).toBeTruthy();
  });

  test("a project on two hosts has a chip for each in the header, and an open row names its own host", async () => {
    const { pushed } = setup();
    await settle(() => screen.queryByRole("heading", { name: "web" }) !== null);
    const header = screen.getByRole("region", { name: "Projeto web" });
    expect(within(header).getByRole("button", { name: "Abrir o host alfa" })).toBeTruthy();
    expect(within(header).getByRole("button", { name: "Abrir o host beta" })).toBeTruthy();
    await click(within(header).getByRole("button", { name: "Mostrar ou esconder web" }));
    await click(within(header).getByRole("button", { name: "2 sessões anteriores" }));
    const row = within(header).getByRole("listitem", { name: "web beta 1" });
    await click(within(row).getByRole("button", { name: "Abrir o host beta" }));
    expect(pushed).toEqual([{ name: "host", host: "beta" }]);
  });

  test("one earlier session is said in the singular", async () => {
    setup();
    await settle(() => screen.queryByRole("heading", { name: "solo" }) !== null);
    await click(screen.getByRole("button", { name: "Mostrar ou esconder solo" }));
    expect(screen.getByRole("button", { name: "1 sessão anterior" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "1 sessões anteriores" })).toBeNull();
  });
});

describe("sessoes-projetos-ui: folders that share a name say where they are (issue #111)", () => {
  test("two api folders on one host are two sections, each with its path hint in the name", async () => {
    setup({ twins: true });
    await settle(() => screen.queryAllByRole("heading", { name: "api" }).length > 0);
    expect(screen.getAllByRole("heading", { name: "api" })).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Projeto api (work)" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Projeto api (play)" })).toBeTruthy();
    expect(screen.getByText("play")).toBeTruthy();
    expect(screen.getByText("work")).toBeTruthy();
  });

  test("a name that is alone has no hint", async () => {
    setup();
    await settle(() => screen.queryByRole("heading", { name: "api" }) !== null);
    expect(screen.getByRole("region", { name: "Projeto api" })).toBeTruthy();
    expect(screen.queryByText("work")).toBeNull();
  });
});
