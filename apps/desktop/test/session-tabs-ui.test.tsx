import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { SessionTabs } = await import("../src/ui/SessionTabs.tsx");

setDefaultTimeout(30_000);
const settle = waiter(5000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const NAMES = ["Conversa", "Mudanças", "Arquivos", "Tempo", "Rastro", "Mensagens"];

const CHANGES = {
  target: "session:claude-1",
  root: "/work/api",
  base: null,
  position: null,
  files: [],
};

function mount(viewKey = "pc/a", composes = false) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  // The views' panels ask a host that is not there: they only need to not get in the way.
  store.checkHealth = async () => {};
  const page = (key: string) => (
    <SessionTabs
      store={store}
      hostId="pc"
      claudeSessionId="claude-1"
      enabled
      messagingId="m-1"
      telemetry
      trace
      files
      viewKey={key}
      {...(composes ? { reviewToComposer: true } : {})}
    >
      <textarea aria-label="caixa" />
    </SessionTabs>
  );
  const view = render(page(viewKey));
  return { store, view, again: (key: string) => view.rerender(page(key)), page };
}

const tabs = () => within(document.body).queryAllByRole("tab");
const selected = () =>
  tabs()
    .filter((tab) => tab.getAttribute("aria-selected") === "true")
    .map((tab) => tab.textContent);
const clickTab = async (index: number) => {
  const tab = tabs()[index];
  expect(tab).not.toBeUndefined();
  await act(async () => {
    fireEvent.click(tab as HTMLElement);
  });
};
const press = async (target: Element, init: KeyboardEventInit) => {
  await act(async () => {
    fireEvent.keyDown(target, init);
  });
};

/** A host that has one draft comment in the session's review. */
function withDraft(store: InstanceType<typeof AppStore>) {
  const draft = {
    id: "c1",
    target: "session:claude-1",
    path: "app.ts",
    side: "new",
    lineStart: 2,
    lineEnd: 2,
    quote: "return total;",
    body: "use total",
    state: "draft",
    createdAt: "2026-11-08T10:00:00Z",
    sentAt: null,
    outdated: false,
  };
  store.hostRequest = (async () => ({ ok: true, data: CHANGES })) as never;
  store.hostCommand = (async (_host: string, type: string) =>
    type === "review.list" ? { comments: [draft] } : null) as never;
}

describe("session-tabs-ui: the views of a session page (issue #107)", () => {
  test("a managed session's Changes can hand the review to the message box, and opens the conversation (#1146)", async () => {
    const { store } = mount("pc/a", true);
    withDraft(store);
    await clickTab(1);
    await settle(
      () =>
        within(document.body).queryByRole("button", { name: /message box|caixa de mensagem/ }) !==
        null,
    );
    await act(async () => {
      fireEvent.click(
        within(document.body).getByRole("button", { name: /message box|caixa de mensagem/ }),
      );
    });
    expect(selected()).toEqual(["Conversa"]);
    expect(within(document.body).queryByRole("tabpanel", { name: "Conversa" }) !== null).toBe(true);
    expect(store.getState().composerFill["pc/a"]).toContain("`app.ts` linha 2");
  });

  test("a page that has no message box to fill keeps only the direct send (#1146)", async () => {
    const { store } = mount("pc/a", false);
    withDraft(store);
    await clickTab(1);
    await settle(
      () =>
        within(document.body).queryByRole("button", { name: /^(Send review|Enviar revisão)/ }) !==
        null,
    );
    expect(
      within(document.body).queryByRole("button", { name: /message box|caixa de mensagem/ }) ===
        null,
    ).toBe(true);
  });

  test("the views are one tablist, one tab is selected and only it is in the tab order", () => {
    mount();
    expect(within(document.body).queryAllByRole("tablist")).toHaveLength(1);
    expect(tabs().map((tab) => tab.textContent)).toEqual(NAMES);
    expect(selected()).toEqual(["Conversa"]);
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
    expect(within(document.body).queryByRole("tabpanel", { name: "Conversa" })).not.toBeNull();
  });

  test("a click selects a view, and the conversation keeps what was typed in its box", async () => {
    mount();
    const box = () => within(document.body).queryByLabelText("caixa") as HTMLTextAreaElement | null;
    await act(async () => {
      fireEvent.change(box() as HTMLTextAreaElement, { target: { value: "metade da frase" } });
    });
    await clickTab(1);
    expect(selected()).toEqual(["Mudanças"]);
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, 0, -1, -1, -1, -1]);
    await clickTab(0);
    expect(selected()).toEqual(["Conversa"]);
    expect(box()?.value).toBe("metade da frase");
  });

  test("the arrow keys, Home and End move between the tabs, with the focus, and wrap around", async () => {
    mount();
    tabs()[0]?.focus();
    await press(tabs()[0] ?? document.body, { key: "ArrowRight" });
    expect(selected()).toEqual(["Mudanças"]);
    expect(document.activeElement).toBe(tabs()[1] as Element);
    await press(tabs()[1] ?? document.body, { key: "End" });
    expect(selected()).toEqual(["Mensagens"]);
    await press(tabs()[5] ?? document.body, { key: "ArrowRight" });
    expect(selected()).toEqual(["Conversa"]);
    await press(tabs()[0] ?? document.body, { key: "ArrowLeft" });
    expect(selected()).toEqual(["Mensagens"]);
    await press(tabs()[5] ?? document.body, { key: "Home" });
    expect(selected()).toEqual(["Conversa"]);
  });

  test("a key the tab bar does not use is left alone: no view changes and the browser keeps it", async () => {
    mount();
    tabs()[0]?.focus();
    const event = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    await act(async () => {
      tabs()[0]?.dispatchEvent(event);
    });
    expect(selected()).toEqual(["Conversa"]);
    expect(event.defaultPrevented).toBe(false);
  });

  test("Alt+1 to Alt+6 pick the views, from the message box too; other combinations and numbers do nothing", async () => {
    mount();
    const box = within(document.body).queryByLabelText("caixa") as HTMLElement;
    box.focus();
    await press(box, { key: "3", altKey: true });
    expect(selected()).toEqual(["Arquivos"]);
    await press(box, { key: "6", altKey: true });
    expect(selected()).toEqual(["Mensagens"]);
    await press(box, { key: "7", altKey: true });
    await press(box, { key: "2", ctrlKey: true });
    await press(box, { key: "2", metaKey: true });
    await press(box, { key: "2" });
    expect(selected()).toEqual(["Mensagens"]);
    await press(box, { key: "1", altKey: true });
    expect(selected()).toEqual(["Conversa"]);
  });

  test("the view keys work right after a session opens from the list, with the focus still on the list row (#885)", async () => {
    mount();
    const row = document.createElement("button");
    document.body.appendChild(row);
    row.focus();
    await press(row, { key: "3", altKey: true });
    expect(selected()).toEqual(["Arquivos"]);
    row.remove();
  });

  test("the view keys stay out of a text field or a dialog elsewhere in the app (#885)", async () => {
    mount();
    const field = document.createElement("input");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const inside = document.createElement("button");
    dialog.appendChild(inside);
    document.body.append(field, dialog);
    await press(field, { key: "3", altKey: true });
    await press(inside, { key: "3", altKey: true });
    expect(selected()).toEqual(["Conversa"]);
    field.remove();
    dialog.remove();
  });

  test("a view the host does not offer has no tab and no number", async () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    render(
      <SessionTabs store={store} hostId="pc" claudeSessionId="c" enabled viewKey="pc/z">
        <textarea aria-label="caixa" />
      </SessionTabs>,
    );
    expect(tabs().map((tab) => tab.textContent)).toEqual(["Conversa", "Mudanças"]);
    const box = within(document.body).queryByLabelText("caixa") as HTMLElement;
    await press(box, { key: "3", altKey: true });
    expect(selected()).toEqual(["Conversa"]);
  });

  test("a session tab comes back on the view it was last on, and another tab starts on the conversation", async () => {
    const { view, page } = mount("pc/a");
    await clickTab(4);
    expect(selected()).toEqual(["Rastro"]);
    view.unmount();
    render(page("pc/a"));
    expect(selected()).toEqual(["Rastro"]);
    cleanup();
    render(page("pc/b"));
    expect(selected()).toEqual(["Conversa"]);
  });

  test("the page on screen tells the store its views, and the store can switch it; leaving takes it off", async () => {
    const { store, view } = mount("pc/a");
    expect(store.sessionViews.available()).toEqual([
      "conversation",
      "changes",
      "files",
      "time",
      "trace",
      "messages",
    ]);
    await act(async () => {
      store.sessionViews.select("files");
    });
    await settle(() => selected()[0] === "Arquivos");
    expect(selected()).toEqual(["Arquivos"]);
    view.unmount();
    expect(store.sessionViews.available()).toEqual([]);
  });
});
