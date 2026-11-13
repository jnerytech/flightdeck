import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { AppStore } from "../../src/lib/app-store.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "../fixtures.ts";
import { settle } from "../wait.ts";
import { fakeXterm } from "./fakes.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SessionTerminal } = await import("../../src/features/terminal/session-terminal.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const OPENING = "Opening the terminal…";
const loading = () => screen.queryByRole("status", { name: OPENING }) !== null;
const terminalShown = () => screen.queryByRole("heading", { name: "Terminal" }) !== null;

/**
 * Issue #2591-adjacent #2607: a session's Terminal view while its shell opens. The host's answer to
 * `terminal.openSession` is held by the test until it says so.
 */
async function setup(source: "session" | "terminal") {
  const d = makeDaemon(cleanups, { terminals: true });
  const store = new AppStore(memoryPlatform(false, "en").platform, {
    baseDelayMs: 10,
    maxDelayMs: 20,
  });
  cleanups.push(() => store.dispose());
  const hostId = await store.roster.add({ name: "pc", url: d.listen().url, token: TOKEN });
  await waitFor(() => store.getState().hosts.find((h) => h.id === hostId)?.status === "online");
  const { terminalId } = await store.terminals.host(hostId).open(d.project, 80, 24);
  let answer: (opened: { terminalId: string } | null) => void = () => {};
  const held = new Promise<{ terminalId: string } | null>((resolve) => {
    answer = resolve;
  });
  store.hostCommand = ((_host: string, type: string) =>
    type === "terminal.openSession" ? held : Promise.resolve(null)) as never;
  const closed: number[] = [];
  render(
    <TContext.Provider value={store.i18n.t}>
      <SessionTerminal
        store={store}
        hostId={hostId}
        viewKey="v1"
        source={source === "session" ? { session: "s1" } : { terminalId }}
        deps={fakeXterm().deps}
        onClosed={() => void closed.push(1)}
      />
    </TContext.Provider>,
  );
  return { closed, terminalId, open: () => answer({ terminalId }), refuse: () => answer(null) };
}

describe("session-terminal-loading: the view says it is opening the shell (issue #2607)", () => {
  test("while the host has not answered, a loading state with the opening label shows", async () => {
    await setup("session");
    await settle(() => loading());
    expect(loading()).toBe(true);
  });

  test("once the shell is open, the loading state is gone and the terminal shows", async () => {
    const page = await setup("session");
    await settle(() => loading());
    await act(async () => page.open());
    await settle(() => terminalShown());
    expect([loading(), terminalShown()]).toEqual([false, true]);
  });

  test("a refused open goes back to the conversation and leaves no loading state", async () => {
    const page = await setup("session");
    await settle(() => loading());
    await act(async () => page.refuse());
    await settle(() => page.closed.length === 1);
    expect([page.closed, loading()]).toEqual([[1], false]);
  });

  test("a source that already has a terminal shows no loading state", async () => {
    await setup("terminal");
    await settle(() => terminalShown());
    expect(loading()).toBe(false);
  });
});
