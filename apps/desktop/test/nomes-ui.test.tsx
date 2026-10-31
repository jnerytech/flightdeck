import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";
import { sidebarNav } from "./sidebar.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const PROJECT = "github.com/acme/flightdeck";
const managed = (id: string, updatedAt: string, persona?: string) => ({
  id,
  name: null,
  cwd: `/r/${id}`,
  status: "idle",
  permissionMode: "default",
  model: null,
  claudeSessionId: null,
  lastSeq: 0,
  createdAt: "2026-10-30T10:00:00.000Z",
  updatedAt,
  projectKey: PROJECT,
  ...(persona ? { persona: { id: persona, name: persona, icon: null } } : {}),
});
const named = (sessionId: string, persona: string, number: number) => ({
  sessionId,
  display: `flightdeck · ${persona} · ${number}`,
  alias: `flightdeck-${persona}-${number}`,
  aliases: [`flightdeck-${persona}-${number}`],
  project: "flightdeck",
  persona,
  number,
  cardNumber: null,
});

/** Titles of the flightdeck group, top to bottom. */
const group = () =>
  [
    ...(screen.queryByRole("region", { name: "Projeto flightdeck" })?.querySelectorAll("li") ?? []),
  ].map((li) => li.getAttribute("aria-label") ?? "");

/** Three idle sessions of one project, the newest first by activity, on Sessões. */
async function open(features: string[], personas: Record<string, string> = {}) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push(...features);
  daemon.hub.managed = [
    managed("m3", "2026-10-30T12:03:00.000Z", personas.m3),
    managed("m2", "2026-10-30T12:02:00.000Z", personas.m2),
    managed("m1", "2026-10-30T12:01:00.000Z", personas.m1),
  ];
  daemon.hub.names = [
    named("m1", "revisor", 10),
    named("m2", "revisor", 2),
    named("m3", "geral", 1),
  ];
  render(<App store={store} />);
  await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await act(async () => {
    store.router.push({ name: "hub" });
  });
  await settle(() => group().length === 3);
  return { store, daemon };
}

describe("nomes-ui: the standard names in Sessões", () => {
  test("a host with names shows each session by its standard name, by name inside the group", async () => {
    await open(["names"]);
    await settle(() => group()[0] === "flightdeck · geral · 1");
    expect(group()).toEqual([
      "flightdeck · geral · 1",
      "flightdeck · revisor · 2",
      "flightdeck · revisor · 10",
    ]);
  });

  test("a host without names keeps the folder titles by latest activity, and is not asked for names", async () => {
    const { daemon } = await open([]);
    expect(group()).toEqual(["m3", "m2", "m1"]);
    expect(daemon.commands.some((c) => c.type === "names.list")).toBe(false);
  });

  test("with phase 20's persona filter, the sessions of one persona keep their standard names in order", async () => {
    await open(["names"], { m1: "revisor", m2: "revisor" });
    await settle(() => group()[0] === "flightdeck · geral · 1");
    await sidebar.openFilters();
    const persona = screen.queryByLabelText("Persona") as HTMLSelectElement | null;
    expect(persona).not.toBeNull();
    await act(async () => {
      fireEvent.change(persona as HTMLElement, { target: { value: "revisor" } });
    });
    expect(group()).toEqual(["flightdeck · revisor · 2", "flightdeck · revisor · 10"]);
  });
});
