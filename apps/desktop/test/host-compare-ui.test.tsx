import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { AppState } from "../src/lib/app-store.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settleMaybe } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { HostCompare } = await import("../src/components/hosts/host-compare.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

interface Fixture {
  id: string;
  daemon?: string;
  claude?: string | null;
  hooks?: "ok" | "warn" | "fail" | null;
  signin?: "ok" | "missing" | null;
  features?: string[];
  status?: string;
}

const BASE_FEATURES = ["doctor.run", "depsCheck"];

function setup(fixtures: Fixture[], lang: "en" | "pt-BR" = "en") {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const asked: string[] = [];
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  store.hostRequest = (async (hostId: string, type: string) => {
    asked.push(`${hostId}:${type}`);
    const f = byId.get(hostId);
    if (type === "doctor.run") {
      const checks = f?.hooks ? [{ id: "hooks", status: f.hooks, detail: "x" }] : [];
      return { ok: true, data: { ok: true, checks } };
    }
    if (type === "deps.check") {
      const items = f?.signin
        ? [{ id: "claudeAuth", group: "required", state: f.signin, breaks: [], fix: [] }]
        : [];
      return { ok: true, data: { items } };
    }
    return { ok: false, message: "unexpected" };
  }) as never;
  const hosts = fixtures.map((f) => ({
    id: f.id,
    name: f.id,
    status: f.status ?? "online",
    sessions: [],
    hostInfo: {
      os: "linux",
      daemonVersion: f.daemon ?? "1.4.0",
      claudeVersion: f.claude === undefined ? "2.1.0" : f.claude,
      features: [...BASE_FEATURES, ...(f.features ?? [])],
    },
  }));
  const push = (patch: Partial<AppState>) =>
    (store as unknown as { update(patch: Partial<AppState>): void }).update(patch);
  push({ hosts: hosts as never, hostsLoaded: true });
  const view = (
    <TContext.Provider value={store.i18n.t}>
      <TooltipProvider>
        <HostCompare store={store} />
      </TooltipProvider>
    </TContext.Provider>
  );
  return { view, asked, push, hosts, store };
}

const mount = (fixtures: Fixture[], lang: "en" | "pt-BR" = "en") => {
  const mounted = setup(fixtures, lang);
  render(mounted.view);
  return mounted;
};

const names = {
  en: {
    title: "Compare hosts",
    show: "Show comparison",
    hide: "Hide comparison",
    refresh: "Refresh",
    table: "Hosts compared",
  },
  "pt-BR": {
    title: "Comparar hosts",
    show: "Mostrar comparação",
    refresh: "Atualizar",
    table: "Hosts comparados",
  },
};

const panel = (lang: "en" | "pt-BR" = "en") =>
  screen.queryByRole("region", { name: names[lang].title });
const table = (lang: "en" | "pt-BR" = "en") =>
  screen.queryByRole("table", { name: names[lang].table });

/** The text of a row's cells, in the hosts' order; the row is found by the name in its header. */
function cells(field: string, lang: "en" | "pt-BR" = "en"): string[] {
  const rows = [...(table(lang)?.querySelectorAll("tbody tr") ?? [])];
  const found = rows.find((r) => r.querySelector("th")?.textContent === field);
  return [...(found?.querySelectorAll("td") ?? [])].map((td) => td.textContent ?? "");
}

async function open(lang: "en" | "pt-BR" = "en") {
  await act(async () => {
    const button = screen.queryByRole("button", { name: names[lang].show });
    if (button) fireEvent.click(button);
  });
}

/** The hosts' answers are in the store and the table has drawn them. */
async function answered(store: { getState(): AppState }, hosts: number) {
  const done = await settleMaybe(
    () => Object.keys(store.getState().healthAt).length === hosts,
    1500,
  );
  await act(async () => {});
  return done;
}

describe("host-compare-ui: when the panel shows and when the hosts are asked", () => {
  test("a single host has nothing to compare with, so the panel is not shown", () => {
    mount([{ id: "alfa" }]);
    expect(panel() === null).toBe(true);
    expect(screen.queryByRole("button", { name: names.en.show }) === null).toBe(true);
  });

  test("two hosts show the panel closed, and nobody is asked until it is opened", async () => {
    const { view, asked, push, hosts } = setup([{ id: "alfa" }, { id: "beta" }]);
    render(view);
    expect(panel() !== null).toBe(true);
    expect(screen.queryByRole("button", { name: names.en.show }) !== null).toBe(true);
    expect(table() === null).toBe(true);
    // Something else in the app changes: still nothing asked.
    await act(async () => push({ hosts: [...hosts] as never }));
    expect(asked).toEqual([]);
  });

  test("opening asks doctor.run of each online host once; Refresh asks again; an offline host is not asked", async () => {
    const { view, asked } = setup([
      { id: "alfa" },
      { id: "beta" },
      { id: "gama", status: "offline" },
    ]);
    render(view);
    await open();
    expect(table() !== null).toBe(true);
    const doctorAsks = () => asked.filter((a) => a.endsWith(":doctor.run")).sort();
    expect(doctorAsks()).toEqual(["alfa:doctor.run", "beta:doctor.run"]);
    await act(async () => {
      const refresh = screen.queryByRole("button", { name: names.en.refresh });
      if (refresh) fireEvent.click(refresh);
    });
    expect(await settleMaybe(() => doctorAsks().length === 4, 1500)).toBe(true);
    expect(doctorAsks()).toEqual([
      "alfa:doctor.run",
      "alfa:doctor.run",
      "beta:doctor.run",
      "beta:doctor.run",
    ]);
  });

  test("hiding the panel asks nobody and removes the table; showing it again asks again", async () => {
    const { view, asked } = setup([{ id: "alfa" }, { id: "beta" }]);
    render(view);
    await open();
    const doctorAsks = () => asked.filter((a) => a.endsWith(":doctor.run")).length;
    expect([doctorAsks(), table() !== null]).toEqual([2, true]);
    await act(async () => {
      const hide = screen.queryByRole("button", { name: names.en.hide });
      if (hide) fireEvent.click(hide);
    });
    // Closing is not a reason to ask: the count stays, the table is gone, the toggle offers Show.
    await act(async () => {});
    expect([
      doctorAsks(),
      table() === null,
      screen.queryByRole("button", { name: names.en.show })?.getAttribute("aria-expanded"),
    ]).toEqual([2, true, "false"]);
    await open();
    expect(await settleMaybe(() => doctorAsks() === 4, 1500)).toBe(true);
  });
});

describe("host-compare-ui: the table", () => {
  const THREE: Fixture[] = [
    { id: "alfa", daemon: "1.4.0", hooks: "ok", signin: "ok" },
    { id: "beta", daemon: "1.4.0", hooks: "ok", signin: "ok" },
    { id: "gama", daemon: "1.3.0", hooks: "warn", signin: "missing" },
  ];

  test("one column per host and one row per field, each row named in its header", async () => {
    mount(THREE);
    await open();
    const columns = [...(table()?.querySelectorAll("thead th") ?? [])].map((th) => th.textContent);
    expect(columns).toEqual(["alfa", "beta", "gama"]);
    const fields = [...(table()?.querySelectorAll("tbody th") ?? [])].map((th) => th.textContent);
    expect(fields).toEqual([
      "Daemon version",
      "Claude Code version",
      "Hooks",
      "Claude sign-in",
      "Features",
    ]);
  });

  test("the cell that differs says why in words, and the cells that agree say nothing", async () => {
    const { store } = mount(THREE);
    await open();
    expect(await answered(store, 3)).toBe(true);
    const [alfa, beta, gama] = cells("Daemon version");
    expect(alfa).toBe("1.4.0");
    expect(beta).toBe("1.4.0");
    expect(gama).toContain("1.3.0");
    expect(gama).toContain("Differs from most hosts, which have 1.4.0");
  });

  test("hooks and sign-in are shown as words, and the reason names the majority's word", async () => {
    const { store } = mount(THREE);
    await open();
    expect(await answered(store, 3)).toBe(true);
    expect(cells("Hooks")[0]).toBe("OK");
    expect(cells("Hooks")[2]).toContain("Warning");
    expect(cells("Hooks")[2]).toContain("which have OK");
    expect(await answered(store, 3)).toBe(true);
    expect(cells("Claude sign-in")[0]).toBe("Signed in");
    expect(cells("Claude sign-in")[2]).toContain("Not signed in");
    expect(cells("Claude sign-in")[2]).toContain("which have Signed in");
  });

  test("a tie marks nothing: two hosts that differ both look the same, with no reason", async () => {
    const { store } = mount([
      { id: "alfa", daemon: "1.4.0" },
      { id: "beta", daemon: "1.3.0" },
    ]);
    await open();
    expect(await answered(store, 2)).toBe(true);
    expect(cells("Daemon version")).toEqual(["1.4.0", "1.3.0"]);
    expect(screen.queryAllByText(/Differs from most hosts/).length).toBe(0);
  });

  test("a value the host does not report is a dash with a word for it, and is never marked", async () => {
    const { store } = mount([
      { id: "alfa", claude: "2.1.0" },
      { id: "beta", claude: "2.1.0" },
      { id: "gama", claude: null },
    ]);
    await open();
    expect(await answered(store, 3)).toBe(true);
    const gama = cells("Claude Code version")[2] ?? "";
    expect(gama).toContain("—");
    expect(gama).toContain("Not known");
    expect(gama).not.toContain("Differs");
  });

  test("an offline host is a column of dashes", async () => {
    const { store } = mount([{ id: "alfa" }, { id: "beta" }, { id: "gama", status: "offline" }]);
    await open();
    expect(await answered(store, 2)).toBe(true);
    expect(cells("Daemon version")[2]).toContain("Not known");
    expect(cells("Features")[2]).toContain("Not known");
  });

  test("features show as a count, and a different set is marked even with the same count", async () => {
    const { store } = mount([
      { id: "alfa", features: ["account", "central"] },
      { id: "beta", features: ["account", "central"] },
      { id: "gama", features: ["account", "quota"] },
    ]);
    await open();
    expect(await answered(store, 3)).toBe(true);
    const [alfa, beta, gama] = cells("Features");
    expect(alfa).toBe("4");
    expect(beta).toBe("4");
    expect(gama).toContain("4");
    expect(gama).toContain("Not the same features as most hosts");
  });
});

describe("host-compare-ui: in Portuguese", () => {
  test("the headings, the words and the reason come from the pt-BR dictionary", async () => {
    const { store } = mount(
      [
        { id: "alfa", daemon: "1.4.0", signin: "ok" },
        { id: "beta", daemon: "1.4.0", signin: "ok" },
        { id: "gama", daemon: "1.3.0", signin: "missing", claude: null },
      ],
      "pt-BR",
    );
    expect(panel("pt-BR") !== null).toBe(true);
    await open("pt-BR");
    expect(await answered(store, 3)).toBe(true);
    expect(cells("Versão do daemon", "pt-BR")[2]).toContain(
      "Difere da maioria dos hosts, que têm 1.4.0",
    );
    expect(cells("Login do Claude", "pt-BR")[2]).toContain("Sem login");
    expect(cells("Versão do Claude Code", "pt-BR")[2]).toContain("Desconhecido");
  });
});
