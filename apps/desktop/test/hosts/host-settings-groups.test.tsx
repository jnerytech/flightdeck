import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { HostPage } = await import("../../src/features/hosts/page.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

setDefaultTimeout(20_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A host that announces the given features, shown with no daemon behind it. */
const hostWith = (features: string[]) => ({
  id: "h1",
  name: "pi",
  url: "ws://x",
  token: "",
  status: "online",
  info: null,
  hostInfo: {
    daemonVersion: "x",
    features,
    pause: { paused: false, running: 0 },
    keepAwake: { enabled: false, held: false, method: null, reason: null },
  },
  incompatibility: null,
  daemonUpdate: null,
  sessions: [],
});

/** The host page with its Settings tab open, in the given language. */
async function settings(language: "en" | "pt-BR", features: string[]) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  cleanups.push(() => store.dispose());
  store.i18n.start();
  store.hostRequest = (async () => ({ ok: false, code: "x", message: "no" })) as never;
  store.hostCommand = (async () => null) as never;
  store.sessionLists.refresh = (async () => {}) as never;
  (store as unknown as { update(p: object): void }).update({ hosts: [hostWith(features)] });
  const page = (features: string[]) => (
    <TContext.Provider value={store.i18n.t}>
      <HostPage
        store={store}
        host={hostWith(features) as never}
        onRename={() => null}
        onReconnect={() => {}}
        onOpenAutoApprovals={() => {}}
        onOpenHistory={() => {}}
        onOpenSession={() => {}}
        onOpenProject={() => {}}
        onSeeAllSessions={() => {}}
        onSeeAllProjects={() => {}}
        onNewSession={() => {}}
        onAddProject={() => {}}
        onRemove={() => {}}
      />
    </TContext.Provider>
  );
  const view = render(page(features));
  const tab = screen.queryByRole("tab", { name: language === "en" ? "Settings" : "Configurações" });
  expect(tab).not.toBeNull();
  await act(async () => {
    fireEvent.mouseDown(tab as HTMLElement, { button: 0 });
    fireEvent.click(tab as HTMLElement);
  });
  // The tab is open: a panel's own heading shows, so a missing group is the failure, not a closed tab.
  const panel = language === "en" ? "Pause new runs" : "Pausar novas execuções";
  expect(screen.queryByRole("heading", { name: panel })).not.toBeNull();
  return { announce: (later: string[]) => view.rerender(page(later)) };
}

const groupHeadings = () =>
  screen.queryAllByRole("heading", { level: 2 }).map((h) => h.textContent);

describe("the Settings tab groups its panels (#3697)", () => {
  test("the panels sit under named groups in order, and a group with no panel for this host has no heading", async () => {
    await settings("en", ["hostPause", "keepAwake"]);
    expect(groupHeadings()).toEqual(["Connection", "Sessions and work"]);
  });

  test("a host with the maintenance panels gets the third group too", async () => {
    await settings("en", ["hostPause", "keepAwake", "logs"]);
    expect(groupHeadings()).toEqual(["Connection", "Sessions and work", "Maintenance and logs"]);
  });

  test("Reconnect and Remove host are in the first group, ahead of the other panels", async () => {
    await settings("en", ["hostPause", "keepAwake", "logs"]);
    const connection = screen.queryByRole("region", { name: "Connection" });
    expect(connection).not.toBeNull();
    const inside = within(connection as HTMLElement);
    expect(inside.queryByRole("button", { name: "Reconnect" })).not.toBeNull();
    expect(inside.queryByRole("button", { name: "Remove host" })).not.toBeNull();
    const sessions = screen.queryByRole("region", { name: "Sessions and work" });
    expect(sessions).not.toBeNull();
    // The first group comes before the second in the page.
    const order = (connection as HTMLElement).compareDocumentPosition(sessions as HTMLElement);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("a row of buttons jumps to a group: one per shown group, and the focus lands on its heading", async () => {
    await settings("en", ["hostPause", "keepAwake", "logs"]);
    const jump = screen.queryByRole("navigation", { name: "Settings groups" });
    expect(jump).not.toBeNull();
    const buttons = within(jump as HTMLElement).queryAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Connection",
      "Sessions and work",
      "Maintenance and logs",
    ]);
    await act(async () => {
      fireEvent.click(buttons[2] as HTMLElement);
    });
    expect(document.activeElement?.textContent).toBe("Maintenance and logs");
    expect(document.activeElement?.tagName).toBe("H2");
  });

  test("a group with no panel has no jump button either", async () => {
    await settings("en", ["hostPause", "keepAwake"]);
    const jump = screen.queryByRole("navigation", { name: "Settings groups" });
    expect(jump).not.toBeNull();
    expect(
      within(jump as HTMLElement)
        .queryAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Connection", "Sessions and work"]);
  });

  test("a host that announces its features after the first paint gets its groups then", async () => {
    const tab = await settings("en", []);
    expect(groupHeadings()).toEqual(["Connection", "Sessions and work"]);
    await act(async () => {
      tab.announce(["logs"]);
    });
    expect(groupHeadings()).toEqual(["Connection", "Sessions and work", "Maintenance and logs"]);
    const jump = screen.queryByRole("navigation", { name: "Settings groups" });
    expect(
      within(jump as HTMLElement)
        .queryAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Connection", "Sessions and work", "Maintenance and logs"]);
  });

  test("an app in Portuguese reads the groups and the jump row in Portuguese", async () => {
    await settings("pt-BR", ["hostPause", "keepAwake", "logs"]);
    expect(groupHeadings()).toEqual(["Conexão", "Sessões e trabalho", "Manutenção e logs"]);
    expect(screen.queryByRole("navigation", { name: "Grupos das configurações" })).not.toBeNull();
  });
});
