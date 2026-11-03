import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { Route } from "../src/lib/router.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { ProjectPage } = await import("../src/ui/ProjectPage.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

function setup(options: { language?: string; known?: boolean; features?: string[] } = {}) {
  const store = new AppStore(memoryPlatform(false, options.language ?? "en").platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const loaded: string[] = [];
  store.loadProjects = (async (hostId: string) => {
    loaded.push(hostId);
    return [];
  }) as never;
  const state = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        status: "online",
        hostInfo: { daemonVersion: "x", features: options.features ?? ["costs"] },
        sessions: [],
      },
    ],
    projects:
      options.known === false
        ? {}
        : { h1: [{ id: "p1", name: "api", path: "/work/api", baseBranch: "develop" }] },
  } as never as ReturnType<typeof store.getState>;
  const went: Route[] = [];
  const view = (
    <ProjectPage
      store={store}
      state={state}
      hostId="h1"
      projectId="p1"
      go={(route) => went.push(route)}
    />
  );
  return { view, went, loaded };
}

describe("projetos-pagina-ui: the project page", () => {
  test("it names the project, its host, branch and folder", async () => {
    render(setup().view);
    await act(() => Bun.sleep(10));
    expect(screen.getByRole("heading", { name: "api" })).not.toBeNull();
    expect(screen.queryByText("alfa · develop · /work/api")).not.toBeNull();
  });

  test("it links Board, Sessions, Workflows, Costs and Settings, each to its screen", async () => {
    const { view, went } = setup();
    render(view);
    await act(() => Bun.sleep(10));
    const links = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? "");
    expect(links).toEqual(["Board", "Sessions", "Workflows", "Costs", "Settings"]);
    for (const name of links) fireEvent.click(screen.getByRole("button", { name }));
    expect(went).toEqual([
      { name: "board", host: "h1", projectId: "p1" },
      { name: "hub", project: { hostId: "h1", projectKey: "host:h1:/work/api", name: "api" } },
      { name: "workflows", host: "h1", projectId: "p1", projectName: "api" },
      { name: "costs" },
      { name: "projects", host: "h1" },
    ]);
  });

  test("a host without the costs feature has no Costs link", async () => {
    render(setup({ features: [] }).view);
    await act(() => Bun.sleep(10));
    const links = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? "");
    expect(links).toEqual(["Board", "Sessions", "Workflows", "Settings"]);
  });

  test("a project the app does not know yet is looked for on its host, and the page says so while it is not there", async () => {
    const { view, loaded } = setup({ known: false });
    render(view);
    await act(() => Bun.sleep(10));
    expect(loaded).toEqual(["h1"]);
    expect(screen.queryByText("This project is not on this host.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Board" })).toBeNull();
  });

  test("in Portuguese the links and the notice follow the dictionary", async () => {
    render(setup({ language: "pt-BR" }).view);
    await act(() => Bun.sleep(10));
    const links = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? "");
    expect(links).toEqual(["Board", "Sessões", "Workflows", "Custos", "Configurações"]);
  });
});
