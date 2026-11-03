import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { CostsSummary } from "@flightdeck/protocol";
import { emptySummary } from "../src/lib/client-costs.ts";
import type { ProjectCard } from "../src/lib/project-cards.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { ProjectsOverview } = await import("../src/ui/ProjectsOverview.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

type Store = InstanceType<typeof AppStore>;

const host = (id: string, name: string, features: string[] = ["costs"]) => ({
  id,
  name,
  url: "ws://x",
  token: "",
  status: "online",
  info: null,
  hostInfo: { daemonVersion: "x", features },
  latencyMs: null,
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
});

const project = (id: string, name: string, hostName: string, baseBranch = "main") => ({
  id,
  name,
  path: `/work/${name}`,
  baseBranch,
  projectKey: `host:${hostName}:/work/${name}`,
});

const external = (id: string, cwd: string, status: string, at: string) => ({
  claudeSessionId: id,
  cwd,
  status,
  lastEventAt: at,
  controllable: false,
  projectKey: `host:alfa:${cwd}`,
});

function setup(options: { costs?: Record<string, CostsSummary | null>; language?: string } = {}) {
  const store: Store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  // The app starts its language from the platform; the screen is rendered without the shell.
  store.i18n.start();
  const asked: string[] = [];
  store.loadPalette = async () => {};
  store.hostCommand = (async (hostId: string, type: string, payload: unknown) => {
    asked.push(`${hostId}:${type}:${JSON.stringify(payload)}`);
    return options.costs?.[hostId] ?? null;
  }) as never;
  const state = {
    ...store.getState(),
    hosts: [host("h1", "alfa"), host("h2", "beta", [])],
    projects: {
      h1: [project("p-api", "api", "alfa", "develop"), project("p-web", "web", "alfa")],
      h2: [project("p-docs", "docs", "beta")],
    },
    externals: {
      "h1/c1": external("c1", "/work/api", "running", "2026-11-02T10:00:00Z"),
      "h1/c2": external("c2", "/work/api", "awaiting_permission", "2026-11-02T11:00:00Z"),
      "h1/c3": external("c3", "/work/web", "idle", "2026-10-30T09:00:00Z"),
    },
    cards: {
      "h1/k1": {
        id: "k1",
        projectId: "p-api",
        column: "in_progress",
        updatedAt: "2026-11-01T00:00:00Z",
      },
      "h1/k2": {
        id: "k2",
        projectId: "p-api",
        column: "backlog",
        updatedAt: "2026-10-01T00:00:00Z",
      },
    },
  } as never as ReturnType<Store["getState"]>;
  const opened: ProjectCard[] = [];
  const view = (s = state) => (
    <TooltipProvider>
      <ProjectsOverview store={store} state={s} onOpen={(card) => opened.push(card)} />
    </TooltipProvider>
  );
  return { store, state, asked, opened, view };
}

const week = (key: string, costUsd: number): CostsSummary => ({
  ...emptySummary("2026-10-28", "2026-11-03"),
  byProject: [{ projectKey: key, costUsd, tokens: 1 }],
});

/** The names of the cards, top to bottom. */
const names = () =>
  [...document.querySelectorAll("ul[aria-label] > li")].map(
    (li) => li.getAttribute("data-project") ?? "",
  );
const card = (name: string) => document.querySelector(`li[data-project="${name}"]`) as HTMLElement;

describe("projetos-lista-ui: the Projects overview", () => {
  test("every project is a card with its host, branch, live sessions, cards, last activity and cost", async () => {
    const { view, asked } = setup({ costs: { h1: week("host:alfa:/work/api", 4.25) } });
    render(view());
    await act(() => Bun.sleep(20));
    expect(names().sort()).toEqual(["api", "docs", "web"]);
    const api = within(card("api"));
    expect(api.getByText("alfa")).not.toBeNull();
    expect(api.getByText("develop")).not.toBeNull();
    expect(api.getByText("US$ 4.25")).not.toBeNull();
    expect(card("api").textContent).toContain("2 live sessions");
    expect(card("api").textContent).toContain("1 in progress");
    expect(card("api").textContent).toContain("1 needs you");
    expect(card("web").textContent).toContain("0 live sessions");
    // The host without the costs feature is never asked; its card says so with a dash.
    expect(asked.filter((a) => a.startsWith("h2:"))).toEqual([]);
    expect(within(card("docs")).getByText("—")).not.toBeNull();
    // The week: seven days ending today.
    const asking = asked.find((a) => a.startsWith("h1:costs.summary"));
    const { from, to } = JSON.parse(asking?.split("costs.summary:")[1] ?? "{}") as {
      from: string;
      to: string;
    };
    expect((Date.parse(to) - Date.parse(from)) / 86_400_000).toBe(6);
  });

  test("search narrows the cards, and says so when none match", async () => {
    const { view } = setup();
    render(view());
    await act(() => Bun.sleep(20));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), {
      target: { value: "beta" },
    });
    expect(names()).toEqual(["docs"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search projects" }), {
      target: { value: "zzz" },
    });
    expect(names()).toEqual([]);
    expect(screen.queryByText("No project matches your search.")).not.toBeNull();
  });

  test("sort changes the order: name, then needs attention first", async () => {
    const { view } = setup();
    render(view());
    await act(() => Bun.sleep(20));
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "name" } });
    expect(names()).toEqual(["api", "docs", "web"]);
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "attention" } });
    expect(names()[0]).toBe("api");
  });

  test("a card opens its project", async () => {
    const { view, opened } = setup();
    render(view());
    await act(() => Bun.sleep(20));
    fireEvent.click(screen.getByRole("button", { name: "Open project api (alfa)" }));
    expect(opened.map((c) => [c.hostId, c.projectId])).toEqual([["h1", "p-api"]]);
  });

  test("with no projects it says so", async () => {
    const { view, state } = setup();
    render(view({ ...state, projects: {} } as never));
    await act(() => Bun.sleep(20));
    expect(screen.queryByText("No projects yet.")).not.toBeNull();
  });

  test("in Portuguese the labels and the plural follow the dictionary", async () => {
    const { view } = setup({ language: "pt-BR" });
    render(view());
    await act(() => Bun.sleep(20));
    expect(screen.queryByRole("searchbox", { name: "Buscar projetos" })).not.toBeNull();
    expect(screen.queryByLabelText("Ordenar por")).not.toBeNull();
    expect(card("api").textContent).toContain("2 sessões ativas");
    expect(card("api").textContent).toContain("1 em andamento");
    expect(card("api").textContent).toContain("1 precisa de você");
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar projetos" }), {
      target: { value: "zzz" },
    });
    expect(screen.queryByText("Nenhum projeto corresponde à busca.")).not.toBeNull();
  });
});
