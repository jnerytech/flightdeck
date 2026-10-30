import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { basename } from "node:path";
import type { ExternalSession } from "@flightdeck/protocol";
import { userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
const {
  act,
  cleanup,
  fireEvent,
  render,
  within,
  waitFor: rtlWaitFor,
} = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { TerminalButton } = await import("../src/ui/TerminalButton.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });

async function setup(terminals: true | "off" = true) {
  const d = makeDaemon(cleanups, { terminals });
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, {
    baseDelayMs: 10,
    maxDelayMs: 20,
  });
  cleanups.push(() => store.dispose());
  const hostId = await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
  await waitFor(() => expect(store.getState().hosts[0]?.hostInfo).not.toBeNull());
  return { ...d, store, hostId };
}

function button(
  store: InstanceType<typeof AppStore>,
  hostId: string,
  cwd: string,
  id: string | null,
) {
  render(
    <TContext.Provider value={store.i18n.t}>
      <TerminalButton store={store} hostId={hostId} target={{ cwd, claudeSessionId: id }} />
    </TContext.Provider>,
  );
}

const click = async (name: string | RegExp) => {
  const target = screen.queryByRole("button", { name });
  expect(target).not.toBeNull();
  await act(async () => {
    if (target) fireEvent.click(target);
  });
};

const external = (claudeSessionId: string, launchId: string): ExternalSession => ({
  claudeSessionId,
  cwd: "/repo",
  transcriptPath: null,
  source: null,
  status: "idle",
  statusReason: null,
  launchId,
  controllable: true,
  projectKey: null,
  startedAt: "2026-10-30T12:00:00Z",
  lastEventAt: "2026-10-30T12:00:00Z",
  endedAt: null,
});
const inject = (store: InstanceType<typeof AppStore>, hostId: string, session: ExternalSession) =>
  (store as unknown as { update(patch: object): void }).update({
    externals: { [`${hostId}/${session.claudeSessionId}`]: session },
  });

describe("claude-aqui: no app", () => {
  test("Abrir Claude aqui (terminal) runs flightdeckd claude in the folder, in a terminal tab", async () => {
    const { store, hostId, root, ptys } = await setup();
    button(store, hostId, root, null);
    await click("Abrir Claude aqui (terminal)");
    await waitFor(() => expect(store.router.current.name).toBe("terminal"));
    expect(ptys.spawned[0]?.argv.slice(0, 2)).toEqual(["flightdeckd", "claude"]);
    expect(ptys.spawned[0]?.cwd).toBe(root);
  });

  test("Continuar no terminal resumes the session with --resume", async () => {
    const { store, hostId, root, ptys } = await setup();
    button(store, hostId, root, "abc-123");
    await click("Continuar no terminal");
    await waitFor(() => expect(ptys.spawned).toHaveLength(1));
    expect(ptys.spawned[0]?.argv).toContain("--resume");
    expect(ptys.spawned[0]?.argv).toContain("abc-123");
  });

  test("with the terminals off only the outside terminal is offered", async () => {
    const { store, hostId, root } = await setup("off");
    button(store, hostId, root, "abc-123");
    expect(screen.queryByRole("button", { name: "Continuar no terminal" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Copiar comando|Abrir no terminal/ }),
    ).not.toBeNull();
  });

  test("with the terminals on the outside terminal is still there", async () => {
    const { store, hostId, root } = await setup();
    button(store, hostId, root, null);
    expect(
      screen.queryByRole("button", { name: /Copiar comando|Abrir no terminal/ }),
    ).not.toBeNull();
  });

  test("a Claude aqui tab has Ver como sessão, which opens the session of the same launch", async () => {
    const { store, hostId, root } = await setup();
    const terminalId = await store.openClaudeHere(hostId, { cwd: root, claudeSessionId: null });
    expect(terminalId).not.toBeNull();
    const [info] = await store.terminalHost(hostId).list();
    expect(info?.launchId).toBeTruthy();
    render(<App store={store} />);
    await act(async () => inject(store, hostId, external("claude-1", info?.launchId as string)));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Ver como sessão" })).not.toBeNull(),
    );
    await click("Ver como sessão");
    expect(store.router.current).toEqual({
      name: "external",
      host: hostId,
      claudeSessionId: "claude-1",
    });
  });

  test("the session of a Claude aqui terminal has Ver terminal, which opens its tab", async () => {
    const { store, hostId, root } = await setup();
    const terminalId = await store.openClaudeHere(hostId, { cwd: root, claudeSessionId: null });
    const [info] = await store.terminalHost(hostId).list();
    render(<App store={store} />);
    await act(async () => {
      inject(store, hostId, external("claude-1", info?.launchId as string));
      store.router.push({ name: "external", host: hostId, claudeSessionId: "claude-1" });
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Ver terminal" })).not.toBeNull(),
    );
    await click("Ver terminal");
    expect(store.router.current).toEqual({
      name: "terminal",
      host: hostId,
      terminalId: terminalId as string,
    });
  });

  test("the palette's Abrir no terminal on a session resumes it in a terminal tab when the host has terminals", async () => {
    const { store, hostId, root, ptys } = await setup();
    render(<App store={store} />);
    // The palette loads the hosts' sessions when it opens: the terminal session comes after.
    await act(async () => {
      store.openSearch();
      await Bun.sleep(300);
    });
    await act(async () =>
      inject(store, hostId, { ...external("claude-9", "launch-x"), cwd: root }),
    );
    const input = document.querySelector("dialog input") as HTMLElement | null;
    expect(input).not.toBeNull();
    await act(async () => {
      fireEvent.change(input as HTMLElement, { target: { value: basename(root) } });
    });
    await act(async () => {
      fireEvent.keyDown(input as HTMLElement, { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(input as HTMLElement, { key: "Tab" });
    });
    const action = screen.queryByRole("option", { name: "Abrir no terminal" });
    expect(action).not.toBeNull();
    await act(async () => {
      if (action) fireEvent.click(action);
    });
    await waitFor(() => expect(ptys.spawned).toHaveLength(1));
    expect(ptys.spawned[0]?.argv).toContain("claude-9");
    expect(store.router.current.name).toBe("terminal");
  });

  test("the reader of an ended or history session has Continuar no terminal, which resumes it in a terminal tab", async () => {
    const { store, hostId, root, ptys, historyRoot, history } = await setup();
    const id = "77777777-7777-4777-8777-777777777777";
    writeTranscript(historyRoot, "-p", id, [userLine({ uuid: "u1", text: "oi", cwd: root })]);
    history.scan();
    render(<App store={store} />);
    await act(async () => {
      store.router.push({ name: "reader", target: { hostId, claudeSessionId: id } });
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Continuar no terminal" })).not.toBeNull(),
    );
    await click("Continuar no terminal");
    await waitFor(() => expect(ptys.spawned).toHaveLength(1));
    expect(ptys.spawned[0]?.argv).toContain(id);
    expect(ptys.spawned[0]?.cwd).toBe(root);
    expect(store.router.current.name).toBe("terminal");
  });
});
