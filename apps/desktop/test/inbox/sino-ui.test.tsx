import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within, waitFor } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");
const { requestLink } = await import("../../src/features/inbox/domain/request-link.ts");

const stores: Array<{ dispose(): void }> = [];
afterEach(() => {
  cleanup();
  for (const s of stores.splice(0)) s.dispose();
});

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
};
/** A time today, `second` seconds after midnight: always today, in order. */
const today = (second: number) => new Date(startOfToday().getTime() + second * 1000).toISOString();
const daysAgo = (days: number) => {
  const day = startOfToday();
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - days, 12).toISOString();
};

async function setup(entries: unknown[]) {
  const phone = memoryPlatform();
  phone.items.set("flightdeck.inbox", JSON.stringify(entries));
  const store = new AppStore(phone.platform, { baseDelayMs: 60_000 });
  stores.push(store);
  render(<App store={store} />);
  await waitFor(() => expect(store.getState().inbox).toHaveLength(entries.length));
  return { store };
}

const bell = () => screen.queryByRole("button", { name: /^Notificações/ });
const open = async () => {
  await waitFor(() => expect(bell()).not.toBeNull());
  await act(async () => {
    fireEvent.click(bell() as HTMLElement);
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeNull());
  return screen.getByRole("dialog");
};
const rows = (panel: HTMLElement) => within(panel).getAllByRole("listitem");

const ASK = (id: string, second: number, extra: Record<string, unknown> = {}) => ({
  id,
  at: today(second),
  title: "Precisa de você",
  body: "wsl · AskUserQuestion",
  subject: "Sessão A",
  host: "wsl",
  ask: "Pergunta: qual banco usar?",
  read: false,
  ...extra,
});

describe("inbox-sino-ui: which notification is unread, and what each one is about", () => {
  test("an unread row has a dot, a bold title and the word unread; a read row has none of them", async () => {
    await setup([ASK("1", 30), { ...ASK("2", 20), subject: "Sessão B", read: true }]);
    const panel = await open();
    const [first, second] = rows(panel) as [HTMLElement, HTMLElement];
    expect(first.querySelector("[data-slot='unread-dot']")).not.toBeNull();
    expect(within(first).getByText("não lida")).not.toBeNull();
    expect(first.querySelector("[data-slot='row-title']")?.className).toContain("font-semibold");
    expect(second.querySelector("[data-slot='unread-dot']")).toBeNull();
    expect(within(second).queryByText("não lida")).toBeNull();
    expect(second.querySelector("[data-slot='row-title']")?.className).not.toContain(
      "font-semibold",
    );
  });

  test("the panel is a dialog named by its title, so a screen reader says what opened (axe aria-dialog-name)", async () => {
    await setup([ASK("a", 10)]);
    const panel = await open();
    expect(screen.getByRole("dialog", { name: "Notificações" })).toBe(panel);
  });

  test("opening the panel marks nothing as read", async () => {
    const { store } = await setup([ASK("1", 30), ASK("2", 20, { subject: "Sessão B" })]);
    await open();
    expect(store.getState().inbox.map((e) => e.read)).toEqual([false, false]);
    expect(bell()?.getAttribute("aria-label")).toBe("Notificações, 2 não lidas");
  });

  test("a click marks that one and opens its target; the others stay unread", async () => {
    const { store } = await setup([
      ASK("1", 30, { route: { name: "settings" } }),
      ASK("2", 20, { subject: "Sessão B" }),
    ]);
    const panel = await open();
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: /^(?!Marcar).*Sessão A/ }));
    });
    expect(store.getState().inbox.map((e) => [e.id, e.read])).toEqual([
      ["1", true],
      ["2", false],
    ]);
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Configurações" })).not.toBeNull(),
    );
  });

  test("the mark-read control of a row marks it and goes nowhere", async () => {
    const { store } = await setup([
      ASK("1", 30, { route: { name: "settings" } }),
      ASK("2", 20, { subject: "Sessão B" }),
    ]);
    const panel = await open();
    const [first] = rows(panel) as [HTMLElement];
    await act(async () => {
      fireEvent.click(within(first).getByRole("button", { name: "Marcar Sessão A como lida" }));
    });
    expect(store.getState().inbox.map((e) => [e.id, e.read])).toEqual([
      ["1", true],
      ["2", false],
    ]);
    expect(screen.queryByRole("heading", { name: "Configurações" })).toBeNull();
    // It is read now, so it moved below the unread one and lost its control.
    const again = rows(screen.getByRole("dialog")).map(
      (r) => r.querySelector("[data-slot='row-title']")?.textContent,
    );
    expect(again).toEqual(["Sessão B", "Sessão A"]);
    expect(
      within(rows(screen.getByRole("dialog"))[1] as HTMLElement).queryByRole("button", {
        name: "Marcar Sessão A como lida",
      }),
    ).toBeNull();
  });

  test("a row names the session and the host, and the request in words, never the tool's name", async () => {
    await setup([ASK("1", 30)]);
    const text = (await open()).textContent ?? "";
    expect(text).toContain("Sessão A");
    expect(text).toContain("wsl · Pergunta: qual banco usar?");
    expect(text).not.toContain("AskUserQuestion");
  });

  test("the questions of one session collapse into one row with a count, and a click reads them all", async () => {
    const group = "wsl/a";
    const { store } = await setup([
      ASK("1", 30, { group }),
      ASK("2", 20, { group }),
      ASK("3", 10, { group }),
      ASK("4", 5, { subject: "Sessão B", group: "wsl/b" }),
    ]);
    const panel = await open();
    expect(rows(panel)).toHaveLength(2);
    const collapsed = rows(panel)[0] as HTMLElement;
    expect(collapsed.textContent).toContain("3 vezes");
    expect(bell()?.getAttribute("aria-label")).toBe("Notificações, 2 não lidas");
    await act(async () => {
      fireEvent.click(within(collapsed).getByRole("button", { name: /^(?!Marcar).*Sessão A/ }));
    });
    expect(store.getState().inbox.map((e) => [e.id, e.read])).toEqual([
      ["1", true],
      ["2", true],
      ["3", true],
      ["4", false],
    ]);
  });

  test("unread rows come first, then the read ones, and Today comes before Earlier", async () => {
    await setup([
      ASK("read", 50, { subject: "Lida", read: true }),
      ASK("new", 10, { subject: "Nova" }),
      ASK("old", 0, { subject: "Antiga", at: daysAgo(3) }),
    ]);
    const panel = await open();
    const order = rows(panel).map((r) => r.querySelector("[data-slot='row-title']")?.textContent);
    expect(order).toEqual(["Nova", "Lida", "Antiga"]);
    expect(within(panel).getByRole("heading", { name: "Hoje" })).not.toBeNull();
    expect(within(panel).getByRole("heading", { name: "Antes" })).not.toBeNull();
  });

  test("a row whose card is gone says so and offers to dismiss, without opening anything", async () => {
    const { store } = await setup([
      ASK("1", 30, {
        subject: "Card X",
        route: { name: "card", host: "h-gone", projectId: "p", cardId: "c" },
      }),
      ASK("2", 20, { subject: "Sessão B" }),
    ]);
    const panel = await open();
    const [gone] = rows(panel) as [HTMLElement];
    expect(gone.textContent).toContain("O que isto citava não existe mais.");
    await act(async () => {
      fireEvent.click(within(gone).getByRole("button", { name: "Descartar Card X" }));
    });
    expect(store.getState().inbox.map((e) => e.id)).toEqual(["2"]);
  });

  test("a click on a request row that no longer waits keeps the panel open, marks nothing and says why (#4200)", async () => {
    const { store } = await setup([
      ASK("1", 30, { subject: "Pedido", link: requestLink("h", "gone-1"), read: false }),
    ]);
    const panel = await open();
    const [row] = rows(panel) as [HTMLElement];
    expect(within(row).queryByText("O que isto citava não existe mais.") === null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    // The row has a live region of its own, outside its button, quiet until the click.
    expect(within(row).queryByRole("status")?.textContent).toBe("");
    expect(within(row).queryByRole("status")?.tagName).toBe("OUTPUT");
    expect(within(row).queryByRole("status")?.closest("button") === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: /^(?!Marcar|Descartar).*Pedido/ }));
    });
    expect(screen.queryByRole("dialog") === null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    expect(store.getState().inbox.map((e) => e.read)).toEqual([false]);
    const why = "Nada a abrir: este pedido não espera mais resposta. Descarte-o para limpar.";
    expect(within(row).queryByRole("status")?.textContent).toBe(why);
    expect(within(row).queryByText(why) === null).toBe(false); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    // Closing the panel forgets the click: the next time the row is as it was.
    await act(async () => {
      fireEvent.keyDown(panel, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const again = await open();
    expect(within(rows(again)[0] as HTMLElement).queryByRole("status")?.textContent).toBe("");
    expect(within(again).queryByText(why) === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });
});
