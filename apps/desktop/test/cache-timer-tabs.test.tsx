import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { AppState } from "../src/lib/app-store.ts";
import { tabIdleSince } from "../src/lib/tab-badge.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { CacheTimer } = await import("../src/components/hub/cache-timer.tsx");
const { SessionStatusLine } = await import("../src/components/session/status-line.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const T0 = Date.parse("2026-11-04T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const route = { name: "session", host: "h", id: "s1" } as const;

const session = (status: string, updatedAt = iso(T0)) => ({
  id: "s1",
  cwd: "/p",
  status,
  updatedAt,
  pendingPermissions: [],
});
const state = (sessions: unknown[]) =>
  ({ hosts: [{ id: "h", name: "pc", sessions }] }) as unknown as AppState;

describe("cache-timer-tabs: since when a tab's session has been idle (issue #159)", () => {
  test("an idle session's tab gives its last activity", () => {
    expect(tabIdleSince(route, state([session("idle")]))).toBe(iso(T0));
  });

  test("running, ended, unknown sessions and other screens give nothing", () => {
    expect(tabIdleSince(route, state([session("running")]))).toBeNull();
    expect(tabIdleSince(route, state([session("ended")]))).toBeNull();
    expect(tabIdleSince(route, state([]))).toBeNull();
    expect(tabIdleSince({ name: "costs" }, state([session("idle")]))).toBeNull();
  });
});

function store(on = true) {
  const mem = memoryPlatform(false, "en");
  if (on) mem.platform.storage.setItem("flightdeck.cacheTimer", "on");
  const clock = { now: T0 + 170_000 };
  const app = new AppStore(mem.platform, { baseDelayMs: 600_000, now: () => clock.now });
  app.i18n.start();
  return app;
}

describe("cache-timer-tabs: the compact countdown (issue #159)", () => {
  test("the icon alone: no digits, the same spoken name, the time in the tooltip", async () => {
    render(<CacheTimer store={store()} since={iso(T0)} compact />);
    const el = screen.getByRole("img", { name: "Prompt cache expires in 2 minutes 10 seconds" });
    expect(el.textContent).toBe("");
    expect(el.querySelector("svg")).not.toBeNull();
    await act(async () => {
      fireEvent.pointerMove(el, { pointerType: "mouse" });
    });
    await settle(() => screen.queryByRole("tooltip") !== null, 3000, "the tooltip opens");
    expect(screen.getByRole("tooltip").textContent).toBe("Prompt cache expires in 2:10");
  });
});

describe("cache-timer-tabs: on the tab strip (issue #159)", () => {
  async function strip(on = true) {
    const app = store(on);
    render(<App store={app} />);
    await act(async () => {
      app.tabs.open(route, { background: true });
      (app as unknown as { update(patch: Partial<AppState>): void }).update({
        hosts: [{ id: "h", name: "pc", status: "offline", sessions: [session("idle")] }] as never,
      });
    });
    return app;
  }

  test("an idle session's tab carries the clock icon, laid over the tab so it takes no width", async () => {
    await strip();
    const clock = await screen.findByRole("img", { name: /^Prompt cache expires/ });
    const item = clock.closest(".tab-item") as HTMLElement;
    expect(item).not.toBeNull();
    expect(item.className).toContain("relative");
    expect(clock.parentElement?.className).toContain("absolute");
    expect(clock.textContent).toBe("");
  });

  test("with the setting off, or for a session that is not idle, there is none", async () => {
    const off = await strip(false);
    expect(off.tabs.tabs).toHaveLength(2);
    expect(screen.queryByRole("img", { name: /^Prompt cache/ })).toBeNull();
    cleanup();
    const on = await strip(true);
    await act(async () => {
      (on as unknown as { update(patch: Partial<AppState>): void }).update({
        hosts: [
          { id: "h", name: "pc", status: "offline", sessions: [session("running")] },
        ] as never,
      });
    });
    expect(screen.queryByRole("img", { name: /^Prompt cache/ })).toBeNull();
  });
});

describe("cache-timer-tabs: in the session's status line, next to the model (issue #159)", () => {
  test("it sits after the model and the mode, inside the status group", () => {
    const app = store();
    render(
      <SessionStatusLine
        t={app.i18n.t}
        model="claude-sonnet-5-5"
        mode="default"
        pickers={{}}
        working={false}
        cache={<CacheTimer store={app} since={iso(T0)} />}
      />,
    );
    const group = screen.getByRole("group", { name: /./ });
    const clock = within(group).getByRole("img", { name: /^Prompt cache expires/ });
    expect(clock.textContent).toBe("2:10");
    const parts = [...group.children].map((c) => c.textContent);
    expect(parts[0]).toBe("claude-sonnet-5-5");
    expect(parts.at(-1)).toBe("2:10");
  });

  test("with no countdown the line is as it was", () => {
    const app = store();
    render(
      <SessionStatusLine
        t={app.i18n.t}
        model={undefined}
        mode="default"
        pickers={{}}
        working={false}
      />,
    );
    expect(screen.queryByRole("img", { name: /^Prompt cache/ })).toBeNull();
  });
});
