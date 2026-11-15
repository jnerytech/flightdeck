import type { AppState } from "../../src/lib/app-store.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");

export { act, cleanup, fireEvent, render };
export const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { HostCompare } = await import("../../src/features/hosts/host-compare.tsx");
const { TooltipProvider } = await import("../../src/components/ui/tooltip.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

type DepState = "ok" | "outdated" | "missing" | null;

export interface Fixture {
  id: string;
  os?: string;
  daemon?: string;
  claude?: string | null;
  hooks?: DepState;
  signin?: DepState;
  gh?: DepState;
  az?: DepState;
  boot?: DepState;
  features?: string[];
  status?: string;
  /** Its health answers are refused, as by a host that cannot be reached. */
  refuse?: boolean;
}

/** The dependencies a fixture's host answers `deps.check` with; a null one is left out. */
function depItems(f: Fixture | undefined) {
  const wanted: Array<[string, DepState | undefined]> = [
    ["claudeAuth", f?.signin],
    ["hooks", f?.hooks],
    ["gh", f?.gh],
    ["az", f?.az],
    ["service", f?.boot],
  ];
  return wanted.flatMap(([id, state]) =>
    state ? [{ id, group: "optional", state, breaks: [], fix: [] }] : [],
  );
}

const BASE_FEATURES = ["doctor.run", "depsCheck"];

export function setup(
  fixtures: Fixture[],
  lang: "en" | "pt-BR" = "en",
  hostId?: string,
  slow: string[] = [],
) {
  // The hosts named in `slow` answer only once `release` is called.
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  const asked: string[] = [];
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  store.hostRequest = (async (hostId: string, type: string) => {
    asked.push(`${hostId}:${type}`);
    if (slow.includes(hostId)) await gate;
    const f = byId.get(hostId);
    if (f?.refuse) return { ok: false, message: "unreachable" };
    if (type === "doctor.run") return { ok: true, data: { ok: true, checks: [] } };
    if (type === "deps.check") return { ok: true, data: { items: depItems(f) } };
    return { ok: false, message: "unexpected" };
  }) as never;
  const hosts = fixtures.map((f) => ({
    id: f.id,
    name: f.id,
    status: f.status ?? "online",
    sessions: [],
    hostInfo: {
      os: f.os ?? "linux",
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
        <HostCompare store={store} {...(hostId ? { hostId } : {})} />
      </TooltipProvider>
    </TContext.Provider>
  );
  return { view, asked, push, hosts, store, release };
}

export const mount = (
  fixtures: Fixture[],
  lang: "en" | "pt-BR" = "en",
  hostId?: string,
  slow: string[] = [],
) => {
  const mounted = setup(fixtures, lang, hostId, slow);
  render(mounted.view);
  return mounted;
};

export const names = {
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

export const panel = (lang: "en" | "pt-BR" = "en") =>
  screen.queryByRole("region", { name: names[lang].title });
export const table = (lang: "en" | "pt-BR" = "en") =>
  screen.queryByRole("table", { name: names[lang].table });

/** The text of a row's cells, in the hosts' order; the row is found by the name in its header. */
export function cells(field: string, lang: "en" | "pt-BR" = "en"): string[] {
  const rows = [...(table(lang)?.querySelectorAll("tbody tr") ?? [])];
  const found = rows.find((r) => r.querySelector("th")?.textContent === field);
  return [...(found?.querySelectorAll("td") ?? [])].map((td) => td.textContent ?? "");
}

export async function open(lang: "en" | "pt-BR" = "en") {
  await act(async () => {
    const button = screen.queryByRole("button", { name: names[lang].show });
    if (button) fireEvent.click(button);
  });
}

/** The names of the Fix buttons on the table, in the order of its rows. */
export const fixNames = () =>
  screen.queryAllByRole("button").flatMap((b) => {
    const text = b.textContent ?? "";
    return /^(Fix|Corrigir) .+ (on|em) /.test(text) ? [text] : [];
  });

/** The hosts' answers are in the store and the table has drawn them. */
export async function answered(store: { getState(): AppState }, hosts: number) {
  const done = await settleMaybe(
    () => Object.keys(store.getState().healthAt).length === hosts,
    1500,
  );
  await act(async () => {});
  return done;
}
