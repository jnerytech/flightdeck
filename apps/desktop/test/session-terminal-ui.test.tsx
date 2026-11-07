import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ExternalSession } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

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
async function onSessionPage() {
  const d = makeDaemon(cleanups, { terminals: true });
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, {
    baseDelayMs: 10,
    maxDelayMs: 20,
  });
  cleanups.push(() => store.dispose());
  store.checkHealth = async () => {};
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "pc", url: d.listen().url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  // createSession opens the session's page, in its own tab.
  const sessionId = (await act(() =>
    store.createSession(hostId, { cwd: d.project, prompt: "go", name: "s1" }),
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
  (await store.terminalHost(hostId).list()).filter((t) => t.exitCode === null);
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
    expect((await live(store, hostId)).length).toBe(1);
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
    expect((await live(store, hostId)).length).toBe(0);
    await clickTab("Terminal");
    await settle(() => terminalShown());
    expect((await live(store, hostId)).length).toBe(1);
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
    const real = store.terminalHost.bind(store);
    (store as unknown as { terminalHost: unknown }).terminalHost = (id: string) =>
      Object.create(real(id), { list: { value: () => Promise.reject(new Error("offline")) } });
    await act(async () => {
      store.router.push({ name: "session", host: hostId, id: sessionId });
    });
    await settle(() => terminalShown());
    (store as unknown as { terminalHost: unknown }).terminalHost = real;
    expect(store.sessionViews.terminalOf(`${hostId}/${sessionId}`)).toBe(
      first?.terminalId as string,
    );
    expect((await live(store, hostId)).length).toBe(1);
  });

  test("a shell the host refuses sends the person back to the conversation, and the view stays offered", async () => {
    const { store, hostId } = await onSessionPage();
    await settle(() => tab("Terminal") !== null);
    const real = store.hostCommand.bind(store);
    (store as unknown as { hostCommand: unknown }).hostCommand = ((
      host: string,
      type: string,
      payload: unknown,
    ) =>
      type === "terminal.openSession"
        ? Promise.resolve(null)
        : (real as (h: string, t: string, p: unknown) => unknown)(host, type, payload)) as never;
    await clickTab("Terminal");
    await settle(() => tab("Conversa")?.getAttribute("aria-selected") === "true");
    expect(terminalShown()).toBe(false);
    expect(tab("Terminal")).not.toBeNull();
    expect((await live(store, hostId)).length).toBe(0);
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
    const real = store.hostCommand.bind(store) as (h: string, t: string, p: unknown) => unknown;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    (store as unknown as { hostCommand: unknown }).hostCommand = ((
      host: string,
      type: string,
      payload: unknown,
    ) =>
      type === "terminal.openSession"
        ? gate.then(() => real(host, type, payload))
        : real(host, type, payload)) as never;
    await clickTab("Terminal");
    const area = store.workspace.areas[0];
    const sessionTab = area?.tabs.find((t) => t.router.current.name === "session");
    await act(async () => {
      store.closeTab(area as never, sessionTab?.id as string);
    });
    release();
    await waitFor(() => expect(ptys.spawned.length).toBe(1));
    await waitFor(async () => expect((await live(store, hostId)).length).toBe(0));
  });

  test("a shell the host refuses to open says why, with no Retry that would open it unseen", async () => {
    const { store, hostId, project } = await onSessionPage();
    await settle(() => tab("Terminal") !== null);
    // The host keeps ten shells at most.
    for (let i = 0; i < 10; i++) await store.terminalHost(hostId).open(project, 80, 24);
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
    expect((await live(store, hostId)).length).toBe(1);
    const area = store.workspace.areas[0];
    const sessionTab = area?.tabs.find((t) => t.router.current.name === "session");
    expect(sessionTab).not.toBeUndefined();
    await act(async () => {
      store.closeTab(area as never, sessionTab?.id as string);
    });
    await waitFor(async () => expect((await live(store, hostId)).length).toBe(0));
  });

  test("a host that does not announce shells for sessions has no Terminal view", async () => {
    const { store } = await onSessionPage();
    await settle(() => tab("Terminal") !== null);
    const host = store.getState().hosts[0];
    await act(async () => {
      (store as unknown as { update(patch: object): void }).update({
        hosts: [
          {
            ...host,
            hostInfo: {
              ...host?.hostInfo,
              features: (host?.hostInfo?.features ?? []).filter((f) => f !== "terminal.session"),
            },
          },
        ],
      });
    });
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
    store.checkHealth = async () => {};
    render(<App store={store} />);
    const hostId = await act(() =>
      store.addHost({ name: "pc", url: d.listen().url, token: TOKEN }),
    );
    await settle(() => store.getState().hosts[0]?.hostInfo != null);
    await store.openClaudeHere(hostId, { cwd: d.root, claudeSessionId: null });
    const [started] = await store.terminalHost(hostId).list();
    const external: ExternalSession = {
      claudeSessionId: "claude-1",
      cwd: "/repo",
      transcriptPath: null,
      source: null,
      status: "idle",
      statusReason: null,
      launchId: started?.launchId ?? null,
      controllable: true,
      projectKey: null,
      startedAt: "2026-10-30T12:00:00Z",
      lastEventAt: "2026-10-30T12:00:00Z",
      endedAt: null,
    };
    await act(async () => {
      (store as unknown as { update(patch: object): void }).update({
        externals: { [`${hostId}/claude-1`]: external },
      });
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
