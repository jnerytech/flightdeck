import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { CLIENTS_KEY, UNASSIGNED } from "../src/lib/clients.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
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
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const KEYS: Record<string, string> = {
  s1: "github.com/acme/api",
  s3: "github.com/acme/api",
  s2: "github.com/beta/app",
  s4: "github.com/beta/app",
};
const managed = (id: string) => ({
  id,
  name: null,
  cwd: `/r/${id}`,
  status: "idle",
  permissionMode: "default",
  model: null,
  claudeSessionId: null,
  lastSeq: 0,
  createdAt: "2026-10-30T10:00:00.000Z",
  updatedAt: "2026-10-30T11:00:00.000Z",
  projectKey: KEYS[id],
});
const message = (id: string, from: string, to: string, text: string, minute: number) => ({
  id,
  fromSession: from,
  fromHost: "h",
  toSession: to,
  toHost: "h",
  text,
  status: "delivered",
  reason: null,
  createdAt: `2026-10-30T12:${String(minute).padStart(2, "0")}:00.000Z`,
  deliveredAt: null,
  teamId: null,
  kind: "session",
});

const client = (id: string, name: string, pattern: string) => ({
  id,
  name,
  color: "indigo",
  rules: [{ id: `r-${id}`, kind: "remote", pattern }],
  defaults: { vaultScope: false },
});

/** Two clients, four sessions, and four messages: inside Acme, inside Beta, between them, and between unknown sessions. */
async function open() {
  const platform = memoryPlatform();
  platform.items.set(
    CLIENTS_KEY,
    JSON.stringify({
      v: 1,
      clients: [
        client("acme", "Acme", "github.com/acme/*"),
        client("beta", "Beta", "github.com/beta/*"),
      ],
      overrides: {},
    }),
  );
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push("messaging");
  daemon.hub.managed = ["s1", "s2", "s3", "s4"].map(managed);
  daemon.messaging.messages = [
    message("m1", "s1", "s3", "dentro da acme", 1),
    message("m2", "s2", "s4", "dentro da beta", 2),
    message("m3", "s1", "s2", "cruzada", 3),
    message("m4", "x1", "x2", "sem projeto", 4),
  ];
  render(<App store={store} />);
  await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Conversas" }));
  });
  const list = () => screen.queryByRole("list", { name: "Mensagens entre sessões" });
  await settle(() => (list()?.children.length ?? 0) === 4);
  await settle(() => store.getState().hub[store.getState().hosts[0]?.id ?? ""] !== undefined);
  const texts = () => [...(list()?.children ?? [])].map((li) => li.textContent ?? "");
  const has = (text: string) => texts().some((t) => t.includes(text));
  return { store, texts, has };
}

describe("clients-filter: the Conversations screen", () => {
  test("all clients lists every message", async () => {
    const { texts } = await open();
    expect(texts()).toHaveLength(4);
  });

  test("a client lists the messages that touch one of its sessions, at either end", async () => {
    const { store, texts, has } = await open();
    await act(async () => store.setClientSelection("acme"));
    await settle(() => texts().length === 2);
    expect(texts()).toHaveLength(2);
    expect(has("dentro da acme")).toBe(true);
    expect(has("cruzada")).toBe(true);
    expect(has("dentro da beta")).toBe(false);
    await act(async () => store.setClientSelection("beta"));
    await settle(() => has("dentro da beta"));
    expect(texts()).toHaveLength(2);
    expect(has("cruzada")).toBe(true);
  });

  test("Unassigned lists the messages of sessions the app cannot place", async () => {
    const { store, texts, has } = await open();
    await act(async () => store.setClientSelection(UNASSIGNED));
    await settle(() => texts().length === 1);
    expect(texts()).toHaveLength(1);
    expect(has("sem projeto")).toBe(true);
  });
});
