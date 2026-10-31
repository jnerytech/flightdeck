import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import {
  DEFAULT_HUB_FILTER,
  type HubRow,
  hubGroups,
  loadHubFilter,
  saveHubFilter,
} from "../src/lib/hub.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { personasHost } from "./personas-ui-setup.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
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
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(15));
}

const QA = { id: "qa", name: "QA / testes", icon: "flask" };
const row = (title: string, persona: HubRow["persona"]): HubRow => ({
  key: title,
  hostId: "h",
  hostName: "alfa",
  origin: "flightdeck",
  claudeSessionId: title,
  sessionId: title,
  title,
  cwd: "/x",
  projectKey: "p",
  state: "idle",
  controllable: false,
  lastActivity: "2026-10-31T10:00:00.000Z",
  pinned: false,
  archived: false,
  summary: null,
  persona,
});

describe("personas-ui: the central", () => {
  test("the Persona filter keeps only the sessions in that persona, and it is kept with the other filters", () => {
    const rows = [row("com qa", QA), row("sem", null)];
    const [only] = hubGroups(rows, { ...DEFAULT_HUB_FILTER, persona: "qa" });
    expect(only?.rows.map((r) => r.title)).toEqual(["com qa"]);
    const kept = new Map<string, string>();
    const storage = {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => {
        kept.set(k, v);
      },
    };
    saveHubFilter(storage, { ...DEFAULT_HUB_FILTER, persona: "qa" });
    expect(loadHubFilter(storage).persona).toBe("qa");
  });

  test("a session opened in a persona shows its badge in the central", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    const { d, repo } = await personasHost(cleanups, store);
    const { sessionId } = d.manager.create({
      cwd: repo,
      prompt: "oi",
      name: "Com persona",
      persona: { id: "qa" },
    });
    await poll(() => d.manager.get(sessionId).status === "idle");
    render(<App store={store} />);
    const item = () => screen.queryByRole("listitem", { name: "Com persona" });
    await settle(() => item() !== null);
    expect(item()).not.toBeNull();
    expect(within(item() as HTMLElement).queryByText("QA / testes")).not.toBeNull();
  });
});
