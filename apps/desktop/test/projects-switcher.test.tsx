import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { switcherHosts } from "../src/lib/tab-scope.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { ProjectsOverview } = await import("../src/ui/ProjectsOverview.tsx");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");
const { settleMaybe } = await import("./wait.ts");

setDefaultTimeout(30_000);
afterEach(cleanup);

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

/** The Projects page, with the switcher on `picked` (or none). */
function setup(picked: string | null, scope: "host" | "all" = "host", offline = false) {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.loadPalette = async () => {};
  store.hostCommand = (async () => null) as never;
  if (picked) store.pickHost(picked);
  store.tabScope.set(scope);
  const state = {
    ...store.getState(),
    hosts: [{ ...host("h1", "alfa"), status: offline ? "offline" : "online" }, host("h2", "beta")],
    projects: {
      h1: [project("p-api", "api", "alfa"), project("p-web", "web", "alfa")],
      h2: [project("p-docs", "docs", "beta")],
    },
  } as never as ReturnType<typeof store.getState>;
  render(
    <TooltipProvider>
      <ProjectsOverview store={store} state={state} onOpen={() => {}} />
    </TooltipProvider>,
  );
  return { store };
}

const names = () =>
  [...document.querySelectorAll("ul[aria-label] > li")]
    .map((li) => li.getAttribute("data-project") ?? "")
    .sort();

describe("projects-switcher: the project lists follow the host switcher (#932)", () => {
  test("one host chosen keeps that host; all hosts' tabs or no host chosen keeps every host", () => {
    const hosts = [{ id: "h1" }, { id: "h2" }];
    expect([
      switcherHosts(hosts, "host", "h1").map((h) => h.id),
      switcherHosts(hosts, "all", "h1").map((h) => h.id),
      switcherHosts(hosts, "host", null).map((h) => h.id),
      // A host the list no longer has (removed elsewhere) is no host chosen: every host.
      switcherHosts(hosts, "host", "gone").map((h) => h.id),
    ]).toEqual([["h1"], ["h1", "h2"], ["h1", "h2"], ["h1", "h2"]]);
  });

  test("with alfa chosen in the switcher, Projects lists alfa's projects only", async () => {
    setup("h1");
    await settleMaybe(() => names().length > 0);
    expect(names()).toEqual(["api", "web"]);
  });

  test("with the tabs of all hosts, Projects lists every host's", async () => {
    setup("h1", "all");
    await settleMaybe(() => names().length === 3);
    expect(names()).toEqual(["api", "docs", "web"]);
  });

  // Review of #948: the page says whose projects these are, and why there are none.
  test("the subtitle names the chosen host, and an offline one says why its projects are missing", async () => {
    setup("h1", "host", true);
    const offline = () =>
      screen.queryByText("alfa is offline. Its projects show again when it reconnects.") !== null;
    await settleMaybe(offline);
    expect({
      offline: offline(),
      subtitle: screen.queryByText("The projects of alfa, with what is running in them.") !== null,
      empty: screen.queryByText("No projects yet.") !== null,
    }).toEqual({ offline: true, subtitle: true, empty: false });
  });

  test("a switch to beta lists beta's projects", async () => {
    const { store } = setup("h1");
    await settleMaybe(() => names().length > 0);
    act(() => store.pickHost("h2"));
    await settleMaybe(() => names().join() === "docs");
    expect(names()).toEqual(["docs"]);
  });
});

describe("projects-switcher: the sidebar's project tree follows the switcher too (#932)", () => {
  test("with alfa chosen, the tree lists alfa's projects and not beta's", () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    store.pickHost("h1");
    const state = {
      ...store.getState(),
      hosts: [host("h1", "alfa"), host("h2", "beta")],
      projects: { h1: [project("p-api", "api", "alfa")], h2: [project("p-docs", "docs", "beta")] },
    } as never as ReturnType<typeof store.getState>;
    render(
      <TooltipProvider>
        <Sidebar
          store={store}
          state={state}
          collapsed={false}
          route={undefined as never}
          t={store.i18n.t}
          go={() => {}}
          onOpenProjectScreen={() => {}}
          onNewSession={() => {}}
          onRemoveHost={() => {}}
          onRenameHost={() => null}
          onOpenSearch={() => {}}
          onNewTab={() => {}}
          onToggleTheme={() => {}}
        />
      </TooltipProvider>,
    );
    expect({
      api: screen.queryByRole("list", { name: "Branches of api" }) !== null,
      docs: screen.queryByRole("list", { name: "Branches of docs" }) !== null,
    }).toEqual({ api: true, docs: false });
  });
});
