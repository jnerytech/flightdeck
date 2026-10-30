import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { AppStore } from "../src/lib/app-store.ts";
import { terminalKeyAction } from "../src/lib/terminal-view.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, waitFor } from "./fixtures.ts";
import { snippetsHost } from "./snippets-ui-setup.ts";
import { fakeXterm } from "./terminal-fakes.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TerminalPage } = await import("../src/ui/TerminalPage.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function setup() {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await snippetsHost(cleanups, store);
  const status = await h.save({ name: "status", type: "command", run: "git status" });
  await h.save({ name: "explicar", type: "prompt", text: "Explique." });
  const eco = store.globalSnippets.save({ name: "eco", type: "command", run: "echo oi" });
  const { terminalId } = await store.terminalHost(h.hostId).open(h.d.project, 80, 24);
  const x = fakeXterm();
  render(
    <TContext.Provider value={store.i18n.t}>
      <TerminalPage
        store={store}
        hostId={h.hostId}
        terminalId={terminalId}
        deps={x.deps}
        onClosed={() => {}}
      />
    </TContext.Provider>,
  );
  await waitFor(() => screen.queryByText("Ao vivo") !== null);
  return { store, x, status, eco, ...h };
}

async function settle(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(15));
}

const picker = () => screen.queryByRole("listbox", { name: "Snippets de comando" });
const offered = () => {
  const list = picker();
  return list
    ? within(list)
        .queryAllByRole("option")
        .map((o) => o.textContent ?? "")
    : [];
};

describe("snippets-uso: in a terminal tab", () => {
  test("Ctrl+Shift+Space is the app's, not the shell's, and no other shortcut takes it", () => {
    const chord = (key: string) => ({
      key,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
      metaKey: false,
    });
    expect(terminalKeyAction(chord(" "))).toBe("snippets");
    expect(terminalKeyAction({ ...chord(" "), shiftKey: false })).toBe("pass");
    expect(["c", "v", "f"].map((k) => terminalKeyAction(chord(k)))).toEqual([
      "copy",
      "paste",
      "search",
    ]);
  });

  test("Ctrl+Shift+Space lists the command snippets of the host and of the app, not the prompts", async () => {
    const { x } = await setup();
    let handled = true;
    await act(async () => {
      handled = x.chord(" ");
    });
    expect(handled).toBe(false);
    await settle(() => offered().length > 0);
    expect(offered().sort()).toEqual(["eco", "status"]);
  });

  test("choosing one hands it to the use dialog and closes the list", async () => {
    const { x, store, status, hostId } = await setup();
    await act(async () => {
      x.chord(" ");
    });
    await settle(() => offered().length > 0);
    const option = picker()
      ? within(picker() as HTMLElement).queryByRole("option", { name: "status" })
      : null;
    expect(option).not.toBeNull();
    await act(async () => {
      fireEvent.click(option as HTMLElement);
    });
    expect(store.getState().snippetChoice).toEqual({ hostId, snippetId: status.id });
    expect(picker()).toBeNull();
  });

  test("a global one is handed over as the app's", async () => {
    const { x, store, eco } = await setup();
    await act(async () => {
      x.chord(" ");
    });
    await settle(() => offered().length > 0);
    const option = picker()
      ? within(picker() as HTMLElement).queryByRole("option", { name: "eco" })
      : null;
    expect(option).not.toBeNull();
    await act(async () => {
      fireEvent.click(option as HTMLElement);
    });
    expect(store.getState().snippetChoice).toEqual({ hostId: null, snippetId: eco.id });
  });
});
