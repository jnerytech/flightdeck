import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within, waitFor } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

const stores: Array<{ dispose(): void }> = [];
afterEach(() => {
  cleanup();
  for (const s of stores.splice(0)) s.dispose();
});

/**
 * Local calendar days, never "hours ago": an hour ago is yesterday at 00:30, and the panel groups
 * by the local day. `today` is the start of today's local day, so it never crosses midnight.
 */
const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
};
const ago = (days: number, earlierToday = false) => {
  if (earlierToday) return new Date(startOfToday().getTime() + 1_000).toISOString();
  if (days === 0) return new Date().toISOString();
  const day = startOfToday();
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - days, 12, 0, 0).toISOString();
};

async function setup(entries: unknown[]) {
  const phone = memoryPlatform();
  phone.items.set("flightdeck.inbox", JSON.stringify(entries));
  const store = new AppStore(phone.platform, { baseDelayMs: 60_000 });
  stores.push(store);
  render(<App store={store} />);
  await waitFor(() => expect(store.getState().inbox).toHaveLength(entries.length));
  return { store, phone };
}

const ENTRIES = [
  {
    id: "1",
    at: ago(0),
    title: "Orçamento",
    body: "alfa · 80%",
    route: { name: "settings" },
    read: false,
  },
  { id: "2", at: ago(0, true), title: "Precisa de você", body: "alfa · Bash", read: false },
  { id: "3", at: ago(2), title: "Sessão terminou", body: "alfa · testes", read: true },
];

const bell = () => screen.queryByRole("button", { name: /^Notificações/ });
const open = async () => {
  await waitFor(() => expect(bell()).not.toBeNull());
  await act(async () => {
    fireEvent.click(bell() as HTMLElement);
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeNull());
};

describe("inbox-ui", () => {
  test("the bell shows the unread count in its name", async () => {
    await setup(ENTRIES);
    await waitFor(() =>
      expect(bell()?.getAttribute("aria-label")).toBe("Notificações, 2 não lidas"),
    );
  });

  test("the panel lists the entries newest first, grouped by day", async () => {
    await setup(ENTRIES);
    await open();
    const panel = screen.getByRole("dialog");
    const text = panel.textContent ?? "";
    expect(text).toContain("Hoje");
    expect(text.indexOf("Orçamento")).toBeLessThan(text.indexOf("Precisa de você"));
    expect(text.indexOf("Precisa de você")).toBeLessThan(text.indexOf("Sessão terminou"));
    expect(within(panel).queryAllByRole("heading", { level: 3 })).toHaveLength(2);
  });

  test("a click on an entry marks it read and opens its screen", async () => {
    const { store } = await setup(ENTRIES);
    await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Orçamento/ }));
    });
    expect(store.getState().inbox.find((e) => e.id === "1")?.read).toBe(true);
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Configurações" })).not.toBeNull(),
    );
  });

  test("mark all as read and clear", async () => {
    const { store } = await setup(ENTRIES);
    await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Marcar todas como lidas" }));
    });
    expect(store.getState().inbox.every((e) => e.read)).toBe(true);
    await waitFor(() => expect(bell()?.getAttribute("aria-label")).toBe("Notificações"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    });
    expect(store.getState().inbox).toEqual([]);
    await waitFor(() =>
      expect(screen.getByRole("dialog").textContent).toContain("Nenhuma notificação."),
    );
  });

  test("Esc closes the panel", async () => {
    await setup(ENTRIES);
    await open();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("an entry whose card is gone opens the pull request instead", async () => {
    const { phone } = await setup([
      {
        id: "9",
        at: ago(0),
        title: "PR em observação",
        body: "alfa · A: falhou",
        route: { name: "card", host: "h-gone", projectId: "p", cardId: "c" },
        fallbackUrl: "https://git.test/acme/api/pull/7",
        read: false,
      },
    ]);
    const opened: string[] = [];
    (phone.platform as { openExternal(url: string): Promise<void> }).openExternal = async (url) => {
      opened.push(url);
    };
    await open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /PR em observação/ }));
    });
    expect(opened).toEqual(["https://git.test/acme/api/pull/7"]);
  });
});
