import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { interceptWire } from "../fake-host.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "../fixtures.ts";
import { waiter } from "../wait.ts";

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
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");
const { RequestError } = await import("../../src/features/hosts/host-connection.ts");

setDefaultTimeout(40_000);
const settle = waiter(10_000);
const waitFor = <T,>(fn: () => T | Promise<T>) => rtlWaitFor(fn, { timeout: 5000 });
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

type TheStore = InstanceType<typeof AppStore>;

/** A host with terminals, a managed session in its project, and the app on that session's page. */
async function onSessionPage(terminals: true | "off" = true) {
  const d = makeDaemon(cleanups, { terminals });
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, {
    baseDelayMs: 10,
    maxDelayMs: 20,
  });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const hostId = await act(() =>
    store.roster.add({ name: "pc", url: d.listen().url, token: TOKEN }),
  );
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  // createSession opens the session's page, in its own tab.
  const sessionId = (await act(() =>
    store.commands.create(hostId, { cwd: d.project, prompt: "go", name: "s1" }),
  )) as string;
  expect(sessionId).not.toBeNull();
  await settle(() => store.getState().sessions[`${hostId}/${sessionId}`]?.status === "idle");
  return { ...d, store, hostId, sessionId };
}

const tab = (name: string) => screen.queryByRole("tab", { name });
const clickTab = async (name: string) => {
  const target = tab(name);
  expect(target).not.toBeNull();
  await act(async () => {
    fireEvent.click(target as HTMLElement);
  });
};
const terminalShown = () => screen.queryByRole("heading", { name: "Terminal" }) !== null;
const live = async (store: TheStore, hostId: string) =>
  (await store.terminals.host(hostId).list()).filter((t) => t.exitCode === null);
const press = async (init: KeyboardEventInit) => {
  await act(async () => {
    fireEvent.keyDown(document.body, init);
  });
};

describe("session-terminal-ui: a Terminal view on the session page (issue #107)", () => {
  test("the view opens a shell in the session's own folder, once, and switching views does not end it", async () => {
    const { store, hostId, sessionId } = await onSessionPage();
    await settle(() => tab("Terminal") !== null);
    expect(terminalShown()).toBe(false);
    await clickTab("Terminal");
    await settle(() => terminalShown());
    await settle(() => screen.queryByText("Ao vivo") !== null);
    const [shell] = await live(store, hostId);
    const cwd = store.getState().sessions[`${hostId}/${sessionId}`]?.cwd;
    expect(shell?.cwd).toBe(cwd);
    // Away and back: the shell is hidden, not closed, and nothing opens a second one.
    await clickTab("Conversa");
    expect(terminalShown()).toBe(false);
    expect((await live(store, hostId)).map((t) => t.terminalId)).toEqual([
      shell?.terminalId as string,
    ]);
    await clickTab("Terminal");
    expect(terminalShown()).toBe(true);
    expect((await live(store, hostId)).map((t) => t.terminalId)).toEqual([
      shell?.terminalId as string,
    ]);
  });

  test("Ctrl+` toggles between the Terminal and the Conversation, and its Alt number shows the Terminal", async () => {
    const { store, hostId } = await onSessionPage();
    await settle(() => tab("Terminal") !== null);
    await press({ key: "`", ctrlKey: true });
    await settle(() => terminalShown());
    await press({ key: "`", ctrlKey: true });
    expect(terminalShown()).toBe(false);
    expect(tab("Conversa")?.getAttribute("aria-selected")).toBe("true");
    // The Alt numbers count the views the page has: the Terminal is the one after the others.
    const bar = screen.queryByRole("tablist", { name: "Visões da sessão" }) as HTMLElement;
    const names = within(bar)
      .queryAllByRole("tab")
      .map((t) => t.textContent);
    await press({ key: String(names.indexOf("Terminal") + 1), altKey: true });
    await settle(() => terminalShown());
    expect(await live(store, hostId)).toHaveLength(1);
  });

  test("closing the terminal from the view returns to the conversation, and the view can open a new shell", async () => {
    const { store, hostId } = await onSessionPage();
    await settle(() => tab("Terminal") !== null);
    await clickTab("Terminal");
    await settle(() => terminalShown());
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Fechar terminal" }) as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(
        within(screen.queryByRole("alertdialog") as HTMLElement).queryByRole("button", {
          name: "Encerrar processo",
        }) as HTMLElement,
      );
    });
    await settle(() => tab("Conversa")?.getAttribute("aria-selected") === "true");
    expect(terminalShown()).toBe(false);
    expect(await live(store, hostId)).toHaveLength(0);
    await clickTab("Terminal");
    await settle(() => terminalShown());
    expect(await live(store, hostId)).toHaveLength(1);
  });

  test("a session page that comes back finds its shell and its view, and opens no second shell", async () => {
    const { store, hostId, sessionId } = await onSessionPage();
    await settle(() => tab("Terminal") !== null);
    await clickTab("Terminal");
    await settle(() => terminalShown());
    const [shell] = await live(store, hostId);
    await act(async () => {
      store.router.push({ name: "hub" });
    });
    await settle(() => tab("Terminal") === null);
    await act(async () => {
      store.router.push({ name: "session", host: hostId, id: sessionId });
    });
    // The tab remembers it was on the Terminal, and the shell is the one it had.
    await settle(() => terminalShown());
    expect((await live(store, hostId)).map((t) => t.terminalId)).toEqual([
      shell?.terminalId as string,
    ]);
  });

  test("when the host cannot say which shells are live, the page attaches the one it kept instead of opening another", async () => {
    const { store, hostId, sessionId } = await onSessionPage();
    await settle(() => tab("Terminal") !== null);
    await clickTab("Terminal");
    await settle(() => terminalShown());
    const [first] = await live(store, hostId);
    await act(async () => {
      store.router.push({ name: "hub" });
    });
    await settle(() => tab("Terminal") === null);
    // The host's list of terminals fails on the wire while the session's page opens again.
    const restore = interceptWire(store, hostId, (type, _payload, next) =>
      type === "terminal.list" ? Promise.reject(new Error("offline")) : next(),
    );
    await act(async () => {
      store.router.push({ name: "session", host: hostId, id: sessionId });
    });
    await settle(() => terminalShown());
    restore();
    expect(store.sessionViews.terminalOf(`${hostId}/${sessionId}`)).toBe(
      first?.terminalId as string,
    );
    expect(await live(store, hostId)).toHaveLength(1);
  });

  test("a shell the host refuses sends the person back to the conversation, and the view stays offered", async () => {
    const { store, hostId } = await onSessionPage();
    await settle(() => tab("Terminal") !== null);
    // The host refuses to open the shell, on the wire.
    interceptWire(store, hostId, (type, _payload, next) =>
      type === "terminal.openSession"
        ? Promise.reject(new RequestError("invalid_state", "recusado"))
        : next(),
    );
    await clickTab("Terminal");
    await settle(() => tab("Conversa")?.getAttribute("aria-selected") === "true");
    expect(terminalShown()).toBe(false);
    expect(tab("Terminal")).not.toBeNull();
    expect(await live(store, hostId)).toHaveLength(0);
  });

  test("Alt numbers and Ctrl+` pressed inside the terminal switch the view and send nothing to the shell", async () => {
    const { ptys } = await onSessionPage();
    await settle(() => tab("Terminal") !== null);
    await clickTab("Terminal");
    await settle(() => terminalShown());
    const helper = () =>
      document.querySelector("textarea.xterm-helper-textarea") as HTMLTextAreaElement | null;
    await settle(() => helper() !== null);
    // What xterm would have seen: a listener on its own text box, which runs after the page's.
    const reached: string[] = [];
    helper()?.addEventListener("keydown", (event) => reached.push(event.key));
    await act(async () => {
      fireEvent.keyDown(helper() as HTMLElement, { key: "2", code: "Digit2", altKey: true });
    });
    expect(tab("Mudanças")?.getAttribute("aria-selected")).toBe("true");
    await clickTab("Terminal");
    await act(async () => {
      fireEvent.keyDown(helper() as HTMLElement, { key: "`", code: "Backquote", ctrlKey: true });
    });
    expect(tab("Conversa")?.getAttribute("aria-selected")).toBe("true");
    // xterm never saw either key, and the shell was never typed to: no ESC and a digit, no NUL.
    expect(reached).toEqual([]);
    expect(ptys.spawned[0]?.written).toEqual([]);
  });

  test("a tab closed while its shell is being opened does not leave that shell running", async () => {
    const { store, hostId, ptys } = await onSessionPage();
    await settle(() => tab("Terminal") !== null);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The host takes its time to open the shell: the call waits for the gate.
    interceptWire(store, hostId, (type, _payload, next) =>
      type === "terminal.openSession" ? gate.then(next) : next(),
    );
    await clickTab("Terminal");
    const area = store.workspace.areas[0];
    const sessionTab = area?.tabs.find((t) => t.router.current.name === "session");
    await act(async () => {
      store.closeTab(area as never, sessionTab?.id as string);
    });
    release();
    await waitFor(() => expect(ptys.spawned).toHaveLength(1));
    await waitFor(async () => expect(await live(store, hostId)).toHaveLength(0));
  });

  test("a shell the host refuses to open says why, with no Retry that would open it unseen", async () => {
    const { store, hostId, project } = await onSessionPage();
    await settle(() => tab("Terminal") !== null);
    // The host keeps ten shells at most.
    for (let i = 0; i < 10; i++) await store.terminals.host(hostId).open(project, 80, 24);
    await clickTab("Terminal");
    await settle(() => tab("Conversa")?.getAttribute("aria-selected") === "true");
    await settle(() => store.getState().notices.length > 0);
    const notice = store.getState().notices.at(-1);
    expect(notice?.reason).toBe("terminal_limit");
    expect(notice?.retry).toBeUndefined();
  });

  test("closing the session's tab ends the shell it opened", async () => {
    const { store, hostId } = await onSessionPage();
    await settle(() => tab("Terminal") !== null);
    await clickTab("Terminal");
    await settle(() => terminalShown());
    expect(await live(store, hostId)).toHaveLength(1);
    const area = store.workspace.areas[0];
    const sessionTab = area?.tabs.find((t) => t.router.current.name === "session");
    expect(sessionTab).not.toBeUndefined();
    await act(async () => {
      store.closeTab(area as never, sessionTab?.id as string);
    });
    await waitFor(async () => expect(await live(store, hostId)).toHaveLength(0));
  });

  // #937: a host whose terminal is off offers no Terminal view, so nothing asks and nothing is
  // refused; turning it on (the host page's button: the setting, then the host's info again) shows
  // the view on the page already open, with no reload.
  test("a host with the terminal off has no Terminal view until it is turned on, then the view opens a shell", async () => {
    const { store, hostId } = await onSessionPage("off");
    // The views bar is up (the session has its other views): the Terminal would be in it by now.
    await settle(() => tab("Mudanças") !== null);
    const before = tab("Terminal") !== null;
    await act(async () => {
      await store.hostCommand(hostId, "terminal.settings", { enabled: true, confirm: true });
      await store.reloadHostInfo(hostId);
    });
    await settle(() => tab("Terminal") !== null);
    await clickTab("Terminal");
    await settle(() => screen.queryByText("Ao vivo") !== null);
    // The shell is up on the host; read after it, a refusal of the open would be a toast by now.
    await waitFor(async () => expect(await live(store, hostId)).toHaveLength(1));
    expect({ before, toasts: store.getState().notices.length }).toEqual({
      before: false,
      toasts: 0,
    });
  });

  test("a host that does not announce shells for sessions has no Terminal view", async () => {
    const { store, hostId } = await onSessionPage();
    await settle(() => tab("Terminal") !== null);
    // The host's info, as an older daemon answers it: the terminal is on, but no shell for sessions.
    interceptWire(store, hostId, async (type, _payload, next) => {
      const info = (await next()) as { features: string[] };
      return type === "host.info"
        ? { ...info, features: info.features.filter((f) => f !== "terminal.session") }
        : info;
    });
    await act(async () => store.reloadHostInfo(hostId));
    await settle(() => tab("Terminal") === null);
    expect(tab("Conversa")).not.toBeNull();
  });

  test("the session of a Claude aqui terminal shows that PTY in its Terminal view, without opening another", async () => {
    const d = makeDaemon(cleanups, { terminals: true });
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform, {
      baseDelayMs: 10,
      maxDelayMs: 20,
    });
    cleanups.push(() => store.dispose());
    render(<App store={store} />);
    const hostId = await act(() =>
      store.roster.add({ name: "pc", url: d.listen().url, token: TOKEN }),
    );
    await settle(() => store.getState().hosts[0]?.hostInfo != null);
    await store.terminals.openClaude(hostId, { cwd: d.root, claudeSessionId: null });
    const [started] = await store.terminals.host(hostId).list();
    expect(started?.launchId).toBeTruthy();
    // The host's hook reports the Claude session of that launch; the app learns it from the host.
    d.central.external.apply("SessionStart", {
      session_id: "claude-1",
      cwd: "/repo",
      launch_id: started?.launchId,
    });
    await act(async () => {
      await store.sessionLists.refresh();
      store.router.push({ name: "external", host: hostId, claudeSessionId: "claude-1" });
    });
    await settle(() => tab("Terminal") !== null);
    await clickTab("Terminal");
    await settle(() => terminalShown());
    expect((await live(store, hostId)).map((t) => t.terminalId)).toEqual([
      started?.terminalId as string,
    ]);
  });
});
