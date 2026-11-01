import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { AppState } from "../src/lib/app-store.ts";
import { tabBadge, tabKind } from "../src/lib/tab-badge.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const session = (status: string, pending = 0) => ({
  id: "s1",
  cwd: "/p",
  status,
  pendingPermissions: Array.from({ length: pending }, (_, i) => ({
    requestId: `r${i}`,
    toolName: "Bash",
    createdAt: "2026-10-30T12:00:00Z",
  })),
});
const state = (sessions: unknown[]) =>
  ({
    hosts: [{ id: "h", name: "pc", sessions }],
    externalRequests: {},
    runs: {},
    cards: {},
    unread: {},
    externals: {},
    meta: {},
    vaultApprovals: [],
  }) as unknown as AppState;
const route = { name: "session", host: "h", id: "s1" } as const;

describe("abas: selos e botão de aba nova", () => {
  test("a session tab says needs-you above running; an idle one and other screens say nothing", () => {
    expect(tabBadge(route, state([session("running", 1)]))).toBe("needs-you");
    expect(tabBadge(route, state([session("running")]))).toBe("running");
    expect(tabBadge(route, state([session("starting")]))).toBe("running");
    expect(tabBadge(route, state([session("idle")]))).toBeNull();
    expect(tabBadge(route, state([]))).toBeNull();
    expect(tabBadge({ name: "costs" }, state([session("running", 1)]))).toBeNull();
  });

  test("the Needs you tab says needs-you while something waits", () => {
    expect(tabBadge({ name: "needs-you" }, state([session("idle", 2)]))).toBe("needs-you");
    expect(tabBadge({ name: "needs-you" }, state([session("idle")]))).toBeNull();
  });

  test("the plus button opens a new tab on the palette, for where Ctrl+T is the browser's", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    const plus = screen.queryByRole("button", { name: "Nova aba" });
    expect(plus).not.toBeNull();
    await act(async () => {
      if (plus) fireEvent.click(plus);
    });
    expect(store.tabs.tabs).toHaveLength(2);
    expect(store.getState().searchOpen).toBe(true);
  });

  test("a tab with a badge says so, in words", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "needs-you" });
      (store as unknown as { update(patch: Partial<AppState>): void }).update({
        hosts: [{ id: "h", name: "pc", status: "online", sessions: [session("idle", 1)] }] as never,
      });
    });
    expect(
      screen.queryByText("Precisa de você", { selector: "[role=tab] [data-badge]" }),
    ).not.toBeNull();
  });

  test("each kind of screen has its icon: session, card (and its diff), terminal, reader, Custos, agent", () => {
    expect(tabKind({ name: "session", host: "h", id: "s" })).toBe("session");
    expect(tabKind({ name: "external", host: "h", claudeSessionId: "c" })).toBe("session");
    expect(tabKind({ name: "new-session", host: "h" })).toBe("session");
    expect(tabKind({ name: "card", host: "h", projectId: "p", cardId: "c" })).toBe("card");
    expect(tabKind({ name: "board", host: "h", projectId: "p" })).toBe("card");
    expect(tabKind({ name: "terminal", host: "h", terminalId: "t" })).toBe("terminal");
    expect(tabKind({ name: "reader", target: { hostId: "h", claudeSessionId: "c" } })).toBe(
      "reader",
    );
    expect(tabKind({ name: "costs" })).toBe("costs");
    expect(tabKind({ name: "agent", host: "h", projectId: "p", projectName: "x" })).toBe("agent");
  });

  test("each screen the sidebar lists has its own kind of tab", () => {
    expect(tabKind({ name: "hub" })).toBe("sessions");
    expect(tabKind({ name: "needs-you" })).toBe("needs-you");
    expect(tabKind({ name: "history", host: "h" })).toBe("history");
    expect(tabKind({ name: "conversations" })).toBe("conversations");
    expect(tabKind({ name: "teams" })).toBe("teams");
    expect(tabKind({ name: "personas" })).toBe("personas");
    expect(tabKind({ name: "snippets" })).toBe("snippets");
    expect(tabKind({ name: "connections" })).toBe("connections");
    expect(tabKind({ name: "vault" })).toBe("vault");
    expect(tabKind({ name: "settings" })).toBe("settings");
    expect(tabKind({ name: "host", host: "h" })).toBe("host");
    expect(tabKind({ name: "add-host" })).toBe("screen");
  });

  test("a tab wears the icon of its sidebar entry, not a shared one", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    const sidebarIcon = (name: string) =>
      screen.queryByRole("button", { name })?.querySelector("svg")?.getAttribute("class");
    for (const [route, kind, entry] of [
      [{ name: "vault" }, "vault", "Cofre"],
      [{ name: "history", host: "h" }, "history", "Histórico"],
      [{ name: "needs-you" }, "needs-you", "Precisa de você"],
      [{ name: "hub" }, "sessions", "Abrir Sessões"],
    ] as const) {
      await act(async () => {
        store.tabs.open(route);
      });
      const icon = screen.queryAllByRole("tab").at(-1)?.querySelector("[data-icon]");
      expect(icon?.getAttribute("data-icon")).toBe(kind);
      const drawn = (sidebarIcon(entry) ?? "").split(" ").find((c) => c.startsWith("lucide-"));
      expect(drawn).toBeDefined();
      expect(icon?.getAttribute("class")).toContain(drawn as string);
    }
  });

  test("the tab shows the icon of its kind", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "costs" });
    });
    const tab = screen.queryAllByRole("tab")[1];
    expect(tab?.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("costs");
  });

  test("a host's tab wears the server icon, not the one of Sessões", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "host", host: "h" });
    });
    const icon = screen.queryAllByRole("tab").at(-1)?.querySelector("[data-icon]");
    expect(icon?.getAttribute("data-icon")).toBe("host");
    expect(icon?.getAttribute("class")).toContain("lucide-server");
  });
});
