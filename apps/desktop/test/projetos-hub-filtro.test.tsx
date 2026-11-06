import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { unfoldAll } from "./unfold.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { SessionsHub } = await import("../src/ui/SessionsHub.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

type Store = InstanceType<typeof AppStore>;
type Filter = { hostId: string; projectKey: string; name: string } | undefined;

const external = (id: string, cwd: string) => ({
  claudeSessionId: id,
  cwd,
  status: "running",
  lastEventAt: "2026-11-02T10:00:00Z",
  controllable: false,
  projectKey: `host:alfa:${cwd}`,
});

function setup(language = "en") {
  const store: Store = new AppStore(memoryPlatform(false, language).platform, {
    baseDelayMs: 600_000,
  });
  store.i18n.start();
  const state = {
    ...store.getState(),
    hosts: [
      {
        id: "h1",
        name: "alfa",
        url: "ws://x",
        token: "",
        status: "online",
        info: null,
        hostInfo: null,
        latencyMs: null,
        incompatibility: null,
        daemonUpdate: null,
        sessions: [],
      },
    ],
    hub: { h1: { managed: [], history: [] } },
    externals: {
      "h1/a1": external("a1", "/work/api"),
      "h1/a2": external("a2", "/work/api"),
      "h1/w1": external("w1", "/work/web"),
    },
  } as never as ReturnType<Store["getState"]>;
  const view = (project?: Filter) => (
    <TooltipProvider>
      <SessionsHub
        store={store}
        state={state}
        onOpen={() => {}}
        isOpen={() => false}
        density="comfortable"
        project={project}
      />
    </TooltipProvider>
  );
  return { view };
}

const API = { hostId: "h1", projectKey: "host:alfa:/work/api", name: "api" };
const rowsDrawn = () => document.querySelectorAll("li[aria-label]").length;

describe("projetos-hub-filtro: the hub filtered to one project", () => {
  test("with a project, only its sessions are drawn, and a chip names it", async () => {
    const { view } = setup();
    render(view(API));
    await unfoldAll(act);
    await waitFor(() => expect(rowsDrawn()).toBeGreaterThan(0));
    expect(rowsDrawn()).toBe(2);
    expect(screen.queryByText("Project: api")).not.toBeNull();
  });

  test("the chip clears the filter and the other projects come back", async () => {
    const { view } = setup();
    render(view(API));
    await unfoldAll(act);
    await waitFor(() => expect(rowsDrawn()).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Clear the project filter" }));
    // The other projects come back folded, as every project starts (issue #111).
    await unfoldAll(act);
    expect(rowsDrawn()).toBe(3);
    expect(screen.queryByText("Project: api")).toBeNull();
  });

  test("a new project from the route replaces the one cleared before", async () => {
    const { view } = setup();
    const shown = render(view(API));
    await unfoldAll(act);
    await waitFor(() => expect(rowsDrawn()).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Clear the project filter" }));
    shown.rerender(view({ hostId: "h1", projectKey: "host:alfa:/work/web", name: "web" }));
    await waitFor(() => expect(screen.queryByText("Project: web")).not.toBeNull());
    await unfoldAll(act);
    expect(rowsDrawn()).toBe(1);
    expect(screen.queryByText("Project: web")).not.toBeNull();
  });

  test("without a project there is no chip, and in Portuguese the chip follows the dictionary", async () => {
    const plain = setup();
    const first = render(plain.view());
    await unfoldAll(act);
    await waitFor(() => expect(rowsDrawn()).toBeGreaterThan(0));
    expect(rowsDrawn()).toBe(3);
    expect(screen.queryByRole("button", { name: "Clear the project filter" })).toBeNull();
    first.unmount();
    const pt = setup("pt-BR");
    render(pt.view(API));
    await waitFor(() => expect(screen.queryByText("Projeto: api")).not.toBeNull());
    expect(screen.queryByText("Projeto: api")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Limpar o filtro de projeto" })).not.toBeNull();
  });
});
