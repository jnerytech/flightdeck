import { expect } from "bun:test";
import { AppStore } from "../../src/lib/app-store.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { interceptWire } from "../fake-host.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "../fixtures.ts";
import { fakeXterm } from "./fakes.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");

export { act, cleanup, fireEvent };
export const screen = liveScreen(within);
const { TerminalPage } = await import("../../src/features/terminal/page.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

const cleanups: Array<() => unknown> = [];
export async function runCleanups() {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

/** `files`: the host reads a terminal's files (#506); without it a path is shown or copied. */
export async function setup(listFails = false, files = true, launch: string | null = null) {
  const d = makeDaemon(cleanups, { terminals: true, review: files });
  const server = d.listen();
  const mem = memoryPlatform(false, "pt-BR");
  const copied: string[] = [];
  mem.platform.copyText = async (text) => void copied.push(text);
  const store = new AppStore(mem.platform, {
    baseDelayMs: 10,
    maxDelayMs: 20,
  });
  cleanups.push(() => store.dispose());
  const hostId = await store.roster.add({ name: "pc", url: server.url, token: TOKEN });
  await waitFor(() => store.getState().hosts.find((h) => h.id === hostId)?.status === "online");
  const { terminalId } = await store.terminals.host(hostId).open(d.project, 80, 24);
  if (listFails) {
    interceptWire(store, hostId, (type, _payload, next) =>
      type === "terminal.list" ? Promise.reject(new Error("recusado")) : next(),
    );
  } else if (launch) {
    // A "Claude aqui" terminal: the host's list carries the launch its session also carries.
    interceptWire(store, hostId, async (type, _payload, next) => {
      const answer = (await next()) as { terminals?: Array<object> };
      return type === "terminal.list"
        ? {
            ...answer,
            terminals: (answer.terminals ?? []).map((t) => ({ ...t, launchId: launch })),
          }
        : answer;
    });
  }
  const x = fakeXterm();
  const closed: number[] = [];
  render(
    <TContext.Provider value={store.i18n.t}>
      <TerminalPage
        store={store}
        hostId={hostId}
        terminalId={terminalId}
        deps={x.deps}
        onClosed={() => void closed.push(1)}
      />
    </TContext.Provider>,
  );
  return { ...d, server, store, hostId, terminalId, x, closed, copied, platform: mem.platform };
}

/** The host's hook reports the Claude session of a launch, and the app reads the host's lists. */
export async function hookSession(d: Awaited<ReturnType<typeof setup>>, launch: string) {
  d.central.external.apply("SessionStart", { session_id: "c1", cwd: "/p", launch_id: launch });
  await act(async () => d.store.sessionLists.refresh());
}

export const state = (name: string) => screen.queryByText(name);
// The right-click menu's items are menu items (#2608), the rest of the screen's controls are buttons.
export const button = (name: string) =>
  screen.queryByRole("button", { name }) ?? screen.queryByRole("menuitem", { name });
export const click = async (name: string) => {
  const target = button(name);
  expect(target).not.toBeNull();
  await act(async () => {
    if (target) fireEvent.click(target);
  });
};
export const settle = (check: () => unknown) => waitFor(() => check()).catch(() => null);

// Issue #2591: SplitView closes the detail on an Esc nobody marked handled (#2579). A control
// either marks the key handled (the search box) or stops it (the menu: the shell must not get it).
/** Whether an Esc pressed in `element` reaches the page unhandled, as SplitView reads it. */
export async function escapeReachesPageUnhandled(element: HTMLElement) {
  const seen: boolean[] = [];
  const read = (e: KeyboardEvent) => void seen.push(!e.defaultPrevented);
  document.body.addEventListener("keydown", read);
  try {
    await act(async () => {
      fireEvent.keyDown(element, { key: "Escape" });
    });
  } finally {
    document.body.removeEventListener("keydown", read);
  }
  return seen[0] ?? null;
}
