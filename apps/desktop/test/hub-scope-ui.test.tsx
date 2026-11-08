import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle, settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { DATA_SCOPE_KEY } = await import("../src/lib/data-scope.ts");
const { SessionsHub } = await import("../src/ui/SessionsHub.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const NAMES: Record<string, string> = { h1: "alfa", h2: "beta" };

const host = (id: string, status = "online") => ({
  id,
  name: NAMES[id],
  url: "ws://x",
  token: "",
  status,
  info: null,
  hostInfo: { daemonVersion: "x", features: [] },
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
});

/** A running session on the host, in a project named after it ("proj-alfa"). */
const session = (hostId: string) => ({
  id: `s-${hostId}`,
  name: `on ${NAMES[hostId]}`,
  cwd: `/work/proj-${NAMES[hostId]}`,
  status: "running",
  permissionMode: "default",
  model: null,
  claudeSessionId: `c-${hostId}`,
  lastSeq: 1,
  createdAt: "2026-11-07T10:00:00Z",
  updatedAt: "2026-11-07T10:00:00Z",
  projectKey: `host:${NAMES[hostId]}:/work/proj-${NAMES[hostId]}`,
});

function setup(
  options: {
    kept?: string;
    offline?: string;
    incompatible?: string;
    route?: string;
    language?: "en" | "pt-BR";
  } = {},
) {
  const mem = memoryPlatform(false, options.language ?? "en");
  if (options.kept) mem.platform.storage.setItem(DATA_SCOPE_KEY, options.kept);
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  store.hostCommand = (async () => ({})) as never;
  const state = {
    ...store.getState(),
    hostsLoaded: true,
    hosts: ["h1", "h2"].map((id) => {
      if (options.offline === id) return host(id, "offline");
      return host(id, options.incompatible === id ? "incompatible" : "online");
    }),
    hub: {
      h1: { managed: [session("h1")], history: [] },
      h2: { managed: [session("h2")], history: [] },
    },
  } as never as ReturnType<typeof store.getState>;
  render(
    <TooltipProvider>
      <SessionsHub
        store={store}
        state={state}
        onOpen={() => {}}
        isOpen={() => false}
        density="comfortable"
        {...(options.route ? { host: options.route } : {})}
      />
    </TooltipProvider>,
  );
  return { store };
}

/** Whether the host's project is listed (projects start folded, so its toggle says it). */
const shown = (title: string) => {
  const project = `proj-${title.replace("on ", "")}`;
  return [`Show or hide ${project}`, `Mostrar ou esconder ${project}`].some(
    (name) => screen.queryByRole("button", { name }) !== null,
  );
};
/** The Data from menu is there: checked before a pick, so a missing menu fails as an assertion. */
const hasMenu = (name: string) => screen.queryByRole("button", { name }) !== null;
const pick = async (menu: string, item: string) => {
  const trigger = screen.queryByRole("button", { name: menu });
  if (!trigger) throw new Error(`no menu named ${menu}`);
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  });
  const entry = screen.queryByRole("menuitemradio", { name: item });
  if (!entry) throw new Error(`no item named ${item}`);
  await act(async () => {
    fireEvent.click(entry);
  });
};

describe("hub-scope-ui: the hub lists the hosts of the data scope (#126 slice 2)", () => {
  test("all hosts lists both; picking beta in Data from lists beta's sessions and keeps the scope", async () => {
    const { store } = setup();
    await settle(() => shown("on alfa") && shown("on beta"));
    expect(hasMenu("Data from All hosts")).toBe(true);
    await pick("Data from All hosts", "beta");
    await settleMaybe(() => !shown("on alfa"));
    expect({
      alfa: shown("on alfa"),
      beta: shown("on beta"),
      scope: store.dataScope.value,
      menu: screen.queryByRole("button", { name: "Data from beta" }) !== null,
    }).toEqual({ alfa: false, beta: true, scope: { kind: "host", hostId: "h2" }, menu: true });
  });

  test("a kept scope lists its host's sessions only", async () => {
    setup({ kept: '{"kind":"host","hostId":"h1"}' });
    await settle(() => shown("on alfa"));
    expect({ alfa: shown("on alfa"), beta: shown("on beta") }).toEqual({
      alfa: true,
      beta: false,
    });
  });

  // #207, kept: "See all sessions" on a host page looks at that host for the visit only.
  test("a host from the route wins for the visit, never rewrites the scope, and a pick ends it", async () => {
    const { store } = setup({ kept: '{"kind":"host","hostId":"h1"}', route: "beta" });
    await settle(() => shown("on beta"));
    const visit = {
      alfa: shown("on alfa"),
      menu: screen.queryByRole("button", { name: "Data from beta" }) !== null,
      scope: store.dataScope.value,
    };
    expect(visit).toEqual({ alfa: false, menu: true, scope: { kind: "host", hostId: "h1" } });
    await pick("Data from beta", "All hosts");
    await settleMaybe(() => shown("on alfa"));
    expect({
      visit,
      after: { alfa: shown("on alfa"), beta: shown("on beta"), scope: store.dataScope.value },
    }).toEqual({
      visit: { alfa: false, menu: true, scope: { kind: "host", hostId: "h1" } },
      after: { alfa: true, beta: true, scope: { kind: "all" } },
    });
  });

  test("a scoped host that is offline says so and offers every host", async () => {
    const { store } = setup({ kept: '{"kind":"host","hostId":"h1"}', offline: "h1" });
    const all = () => screen.queryByRole("button", { name: "Show all hosts" });
    await settleMaybe(() => all() !== null);
    const said = screen.queryByText(/alfa is offline/) !== null;
    const button = all();
    if (button) {
      await act(async () => {
        fireEvent.click(button);
      });
    }
    expect({ said, offered: button !== null, scope: store.dataScope.value }).toEqual({
      said: true,
      offered: true,
      scope: { kind: "all" },
    });
  });

  // #207: a visit never rewrites the scope, even through the offline notice.
  test("a visited host that is offline offers every host for the visit, and the scope stays", async () => {
    const { store } = setup({
      kept: '{"kind":"host","hostId":"h2"}',
      route: "alfa",
      offline: "h1",
    });
    const all = () => screen.queryByRole("button", { name: "Show all hosts" });
    await settleMaybe(() => all() !== null);
    const said = screen.queryByText(/alfa is offline/) !== null;
    const button = all();
    if (button) {
      await act(async () => {
        fireEvent.click(button);
      });
    }
    await settleMaybe(() => shown("on alfa") && shown("on beta"));
    expect({
      said,
      offered: button !== null,
      alfa: shown("on alfa"),
      beta: shown("on beta"),
      menu: screen.queryByRole("button", { name: "Data from All hosts" }) !== null,
      scope: store.dataScope.value,
    }).toEqual({
      said: true,
      offered: true,
      alfa: true,
      beta: true,
      menu: true,
      scope: { kind: "host", hostId: "h2" },
    });
  });

  // #886: Sessions lists sessions, so its notice says they come back, not numbers.
  test("an offline scoped host says its sessions come back when it reconnects", async () => {
    setup({ kept: '{"kind":"host","hostId":"h1"}', offline: "h1" });
    const sessions = () =>
      screen.queryByText(/alfa is offline\. Its sessions show again when it reconnects\./) !== null;
    await settleMaybe(sessions);
    expect(sessions()).toBe(true);
  });

  // Review of #904: the scoped host stays in the menu, checked, so the menu says what is chosen.
  test("an incompatible scoped host asks for a daemon update, and the menu still shows it chosen", async () => {
    setup({ kept: '{"kind":"host","hostId":"h2"}', incompatible: "h2" });
    const update = () => screen.queryByText(/beta needs a daemon update/) !== null;
    await settleMaybe(update);
    const said = update();
    expect(hasMenu("Data from beta")).toBe(true);
    const trigger = screen.queryByRole("button", { name: "Data from beta" }) as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    });
    const items = screen.queryAllByRole("menuitemradio").map((item) => item.textContent);
    const checked = screen
      .queryAllByRole("menuitemradio")
      .filter((item) => item.getAttribute("aria-checked") === "true")
      .map((item) => item.textContent);
    expect({ said, items, checked }).toEqual({
      said: true,
      items: ["All hosts", "alfa", "beta"],
      checked: ["beta"],
    });
  });

  test("on All hosts the menu does not offer an incompatible host", async () => {
    setup({ incompatible: "h2" });
    await settle(() => shown("on alfa"));
    expect(hasMenu("Data from All hosts")).toBe(true);
    const trigger = screen.queryByRole("button", { name: "Data from All hosts" }) as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    });
    const items = screen.queryAllByRole("menuitemradio").map((item) => item.textContent);
    expect(items).toEqual(["All hosts", "alfa"]);
  });

  // One control for whose sessions: the Filters popover and the row above the groups had their own.
  test("the hub has no host filter of its own any more", async () => {
    setup();
    await settle(() => shown("on alfa"));
    const filters = screen.queryByRole("button", { name: /^Filters/ });
    if (!filters) throw new Error("no Filters button");
    await act(async () => {
      fireEvent.pointerDown(filters);
      fireEvent.click(filters);
    });
    await settle(() => screen.queryByRole("button", { name: "Pinned only" }) !== null);
    expect({
      select: screen.queryByRole("combobox", { name: "Host" }) !== null,
      row: screen.queryByRole("group", { name: "Hosts" }) !== null,
    }).toEqual({ select: false, row: false });
  });

  test("em português", async () => {
    setup({ language: "pt-BR" });
    await settle(() => shown("on alfa"));
    expect(screen.queryByRole("button", { name: "Dados de Todos os hosts" }) !== null).toBe(true);
  });

  test("em português, o host fora do ar oferece todos os hosts", async () => {
    setup({ language: "pt-BR", kept: '{"kind":"host","hostId":"h1"}', offline: "h1" });
    await settleMaybe(
      () => screen.queryByRole("button", { name: "Mostrar todos os hosts" }) !== null,
    );
    expect(screen.queryByRole("button", { name: "Mostrar todos os hosts" }) !== null).toBe(true);
  });
});

// #126 slice 4: a project scope (picked here, on Home or on Costs) lists that project's sessions,
// on every host it is on, and the menu offers the hub's projects.
describe("hub-scope-ui: a project scope (#126 slice 4)", () => {
  const ALFA_PROJECT = '{"kind":"project","projectKey":"host:alfa:/work/proj-alfa"}';

  test("a kept project scope lists that project's sessions only, and the menu names it", async () => {
    setup({ kept: ALFA_PROJECT });
    await settle(() => shown("on alfa"));
    expect({
      alfa: shown("on alfa"),
      beta: shown("on beta"),
      menu: hasMenu("Data from proj-alfa"),
    }).toEqual({ alfa: true, beta: false, menu: true });
  });

  test("the menu lists the hub's projects; picking one lists its sessions and keeps the scope", async () => {
    const { store } = setup();
    await settle(() => shown("on alfa") && shown("on beta"));
    expect(hasMenu("Data from All hosts")).toBe(true);
    const trigger = screen.queryByRole("button", { name: "Data from All hosts" }) as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    });
    const entry = screen.queryByRole("menuitemradio", { name: "proj-beta" });
    expect(entry).not.toBeNull();
    await act(async () => {
      fireEvent.click(entry as HTMLElement);
    });
    await settleMaybe(() => !shown("on alfa"));
    expect({
      alfa: shown("on alfa"),
      beta: shown("on beta"),
      scope: store.dataScope.value,
    }).toEqual({
      alfa: false,
      beta: true,
      scope: { kind: "project", projectKey: "host:beta:/work/proj-beta" },
    });
  });

  test("em português, o menu nomeia o projeto do escopo", async () => {
    setup({ kept: ALFA_PROJECT, language: "pt-BR" });
    await settle(() => shown("on alfa"));
    expect({ beta: shown("on beta"), menu: hasMenu("Dados de proj-alfa") }).toEqual({
      beta: false,
      menu: true,
    });
  });
});
