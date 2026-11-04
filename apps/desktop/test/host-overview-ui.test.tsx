import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { HubRow } from "../src/lib/hub.ts";
import type { ProjectCard } from "../src/lib/project-cards.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen, within, waitFor } = await import(
  "@testing-library/react"
);
const { AppStore } = await import("../src/lib/app-store.ts");
const { HostOverview } = await import("../src/components/hosts/host-overview.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

type Store = InstanceType<typeof AppStore>;

const host = (id: string, name: string) => ({
  id,
  name,
  url: "ws://x",
  token: "",
  status: "online",
  info: null,
  hostInfo: { daemonVersion: "x", features: [] },
  latencyMs: null,
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
});

const project = (id: string, name: string, hostName: string) => ({
  id,
  name,
  path: `/work/${name}`,
  baseBranch: "main",
  projectKey: `host:${hostName}:/work/${name}`,
});

const external = (id: string, cwd: string, status: string, at: string, hostName: string) => ({
  claudeSessionId: id,
  cwd,
  status,
  lastEventAt: at,
  controllable: false,
  projectKey: `host:${hostName}:${cwd}`,
});

function setup(forHost: "h1" | "h2" | "h3") {
  const store: Store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.loadPalette = async () => {};
  store.hostCommand = (async () => null) as never;
  const state = {
    ...store.getState(),
    hosts: [host("h1", "alfa"), host("h2", "beta"), host("h3", "gama")],
    projects: {
      h1: [project("p-api", "api", "alfa"), project("p-web", "web", "alfa")],
      h2: [project("p-docs", "docs", "beta")],
      h3: [],
    },
    externals: {
      "h1/c1": external("c1", "/work/api", "running", "2026-11-02T10:00:00Z", "alfa"),
      "h1/c2": external("c2", "/work/web", "awaiting_permission", "2026-11-02T09:00:00Z", "alfa"),
      "h2/c3": external("c3", "/work/docs", "idle", "2026-11-03T09:00:00Z", "beta"),
    },
    cards: {},
  } as never as ReturnType<Store["getState"]>;
  const calls: string[] = [];
  const opened: Array<HubRow | ProjectCard> = [];
  const target = state.hosts.find((h) => h.id === forHost) as { id: string; name: string };
  const view = (
    <TooltipProvider>
      <HostOverview
        store={store}
        state={state}
        host={target}
        onOpenSession={(row) => opened.push(row)}
        onOpenProject={(card) => opened.push(card)}
        onSeeAllSessions={() => calls.push("sessions")}
        onSeeAllProjects={() => calls.push("projects")}
        onNewSession={() => calls.push("new")}
      />
    </TooltipProvider>
  );
  return { view, calls, opened };
}

const region = (name: string) => screen.getByRole("region", { name });
const titles = (name: string) =>
  within(region(name))
    .getAllByRole("listitem")
    .map((li) => li.getAttribute("aria-label") ?? li.getAttribute("data-project") ?? "");

describe("host-overview-ui: a host page leads with its sessions and projects", () => {
  test("sessions first, then projects, only this host's, the ones that need you first", async () => {
    const { view } = setup("h1");
    render(view);
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Sessions of alfa" })).not.toBeNull(),
    );
    // The one waiting for permission comes before the running one; beta's session is not here.
    expect(titles("Sessions of alfa")).toEqual(["web", "api"]);
    expect(titles("Projects of alfa").sort()).toEqual(["api", "web"]);
    const all = [...document.querySelectorAll("[role='region']")].map((r) =>
      r.getAttribute("aria-label"),
    );
    expect(all.indexOf("Sessions of alfa")).toBeLessThan(all.indexOf("Projects of alfa"));
    expect(document.body.textContent).not.toContain("docs");
  });

  test("See all goes to the list of the host, and the rows open their session and project", async () => {
    const { view, calls, opened } = setup("h1");
    render(view);
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Sessions of alfa" })).not.toBeNull(),
    );
    await act(
      async () => void fireEvent.click(screen.getByRole("button", { name: "See all sessions" })),
    );
    await act(
      async () => void fireEvent.click(screen.getByRole("button", { name: "See all projects" })),
    );
    expect(calls).toEqual(["sessions", "projects"]);
    await act(
      async () =>
        void fireEvent.click(
          within(region("Sessions of alfa")).getByRole("button", { name: "web" }),
        ),
    );
    expect((opened[0] as HubRow).hostId).toBe("h1");
    expect((opened[0] as HubRow).title).toBe("web");
    await act(
      async () =>
        void fireEvent.click(
          within(region("Projects of alfa")).getByRole("button", { name: /api/ }),
        ),
    );
    expect((opened[1] as ProjectCard).projectId).toBe("p-api");
  });

  test("another host's page shows its own session and project", async () => {
    const { view } = setup("h2");
    render(view);
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Projects of beta" })).not.toBeNull(),
    );
    expect(titles("Sessions of beta")).toEqual(["docs"]);
    expect(titles("Projects of beta")).toEqual(["docs"]);
  });

  test("a host with nothing shows both empty states, and New session asks to start one", async () => {
    const { view, calls } = setup("h3");
    render(view);
    await waitFor(() => expect(screen.queryByText("No sessions on this host yet.")).not.toBeNull());
    expect(screen.queryByText("No projects on this host yet.")).not.toBeNull();
    await act(
      async () => void fireEvent.click(screen.getByRole("button", { name: "New session" })),
    );
    expect(calls).toEqual(["new"]);
    expect(screen.queryByRole("button", { name: "See all sessions" })).toBeNull();
  });
});

describe("host-overview-ui: the Projects list filtered by a host", () => {
  test("only that host's cards, with a chip that clears the filter", async () => {
    const { ProjectsOverview } = await import("../src/ui/ProjectsOverview.tsx");
    const store: Store = new AppStore(memoryPlatform(false, "en").platform, {
      baseDelayMs: 600_000,
    });
    store.i18n.start();
    store.loadPalette = async () => {};
    store.hostCommand = (async () => null) as never;
    const state = {
      ...store.getState(),
      hosts: [host("h1", "alfa"), host("h2", "beta")],
      projects: {
        h1: [project("p-api", "api", "alfa")],
        h2: [project("p-docs", "docs", "beta")],
      },
      externals: {},
      cards: {},
    } as never as ReturnType<Store["getState"]>;
    const cleared: string[] = [];
    render(
      <TooltipProvider>
        <ProjectsOverview
          store={store}
          state={state}
          host="h1"
          onClearHost={() => cleared.push("x")}
          onOpen={() => {}}
        />
      </TooltipProvider>,
    );
    await waitFor(() => expect(document.querySelectorAll("li[data-project]").length).toBe(1));
    expect(document.querySelector("li[data-project='api']")).not.toBeNull();
    await act(
      async () =>
        void fireEvent.click(screen.getByRole("button", { name: "Clear host filter: alfa" })),
    );
    expect(cleared).toEqual(["x"]);
  });
});
