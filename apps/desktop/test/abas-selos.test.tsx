import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { AppState } from "../src/lib/app-store.ts";
import { tabBadge } from "../src/lib/tab-badge.ts";
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
    externals: {},
    meta: {},
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
});
