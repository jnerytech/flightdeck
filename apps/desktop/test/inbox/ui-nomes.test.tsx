import { afterEach, describe, expect, test } from "bun:test";
import { formatWhen } from "../../src/i18n/format.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within, waitFor } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

const stores: Array<{ dispose(): void }> = [];
afterEach(() => {
  cleanup();
  for (const s of stores.splice(0)) s.dispose();
});

type Lang = "en" | "pt-BR";

const WORDS = {
  en: {
    bell: /^Notifications/,
    markRead: (title: string) => `Mark ${title} as read`,
    markUnread: (title: string) => `Mark ${title} as unread`,
    dismiss: (title: string) => `Dismiss ${title}`,
    markedRead: (title: string) => `Marked as read: ${title}`,
    markedUnread: (title: string) => `Marked as unread: ${title}`,
    dismissed: (title: string) => `Dismissed: ${title}`,
  },
  "pt-BR": {
    bell: /^Notificações/,
    markRead: (title: string) => `Marcar ${title} como lida`,
    markUnread: (title: string) => `Marcar ${title} como não lida`,
    dismiss: (title: string) => `Descartar ${title}`,
    markedRead: (title: string) => `Marcada como lida: ${title}`,
    markedUnread: (title: string) => `Marcada como não lida: ${title}`,
    dismissed: (title: string) => `Descartada: ${title}`,
  },
} as const;

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
};
const today = (second: number) => new Date(startOfToday().getTime() + second * 1000).toISOString();
const daysAgo = (days: number) => {
  const day = startOfToday();
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - days, 12).toISOString();
};

const ENTRY = (id: string, at: string, extra: Record<string, unknown> = {}) => ({
  id,
  at,
  title: "Needs you",
  body: "wsl · AskUserQuestion",
  subject: `Session ${id}`,
  host: "wsl",
  ask: "Which database?",
  read: false,
  ...extra,
});

async function openPanel(lang: Lang, entries: unknown[]) {
  const phone = memoryPlatform(false, lang);
  phone.items.set("flightdeck.inbox", JSON.stringify(entries));
  const store = new AppStore(phone.platform, { baseDelayMs: 60_000 });
  stores.push(store);
  render(<App store={store} />);
  await waitFor(() => expect(store.getState().inbox).toHaveLength(entries.length));
  const bell = () => screen.queryByRole("button", { name: WORDS[lang].bell });
  await waitFor(() => expect(bell()).not.toBeNull());
  await act(async () => {
    fireEvent.click(bell() as HTMLElement);
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeNull());
  return screen.getByRole("dialog");
}

const rowOf = (panel: HTMLElement, title: string) =>
  within(panel)
    .getAllByRole("listitem")
    .find(
      (li) => li.querySelector("[data-slot='row-title']")?.textContent === title,
    ) as HTMLElement;

describe.each(["en", "pt-BR"] as const)("the notification center, names and times (%s)", (lang) => {
  const w = WORDS[lang];

  test("each row's mark control names its own row", async () => {
    const panel = await openPanel(lang, [
      ENTRY("A", today(30)),
      ENTRY("B", today(20)),
      ENTRY("C", today(10), { read: true }),
    ]);
    const names = (title: string) =>
      within(rowOf(panel, title))
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? "");
    expect(names("Session A").includes(w.markRead("Session A"))).toBe(true);
    expect(names("Session B").includes(w.markRead("Session B"))).toBe(true);
    expect(names("Session C").includes(w.markUnread("Session C"))).toBe(true);
  });

  test("the Dismiss control of a gone row names its row", async () => {
    const panel = await openPanel(lang, [
      ENTRY("G", today(30), {
        route: { name: "card", host: "h-gone", projectId: "p", cardId: "c" },
      }),
    ]);
    const button = within(rowOf(panel, "Session G")).queryByRole("button", {
      name: w.dismiss("Session G"),
    });
    expect(button).not.toBeNull();
  });

  /** What the panel's polite status says now, and what holds the focus. */
  const said = (panel: HTMLElement) =>
    panel.querySelector('[data-slot="inbox-live"]')?.textContent ?? "";
  const pickOf = (panel: HTMLElement, element: Element | null) =>
    element instanceof HTMLButtonElement &&
    element.classList.contains("inbox-pick") &&
    panel.contains(element);

  test("Mark as read says so and puts the focus on a row's pick button, not on the page (#4030)", async () => {
    const panel = await openPanel(lang, [ENTRY("A", today(30)), ENTRY("B", today(20))]);
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: w.markRead("Session A") }));
    });
    expect(said(panel)).toBe(w.markedRead("Session A"));
    expect(pickOf(panel, document.activeElement)).toBe(true);
  });

  test("Mark as unread says so and puts the focus on a row's pick button (#4030)", async () => {
    const panel = await openPanel(lang, [
      ENTRY("A", today(30)),
      ENTRY("C", today(10), { read: true }),
    ]);
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: w.markUnread("Session C") }));
    });
    expect(said(panel)).toBe(w.markedUnread("Session C"));
    expect(pickOf(panel, document.activeElement)).toBe(true);
  });

  test("Dismiss says so and the focus goes to the row now in its place (#4030)", async () => {
    const panel = await openPanel(lang, [
      ENTRY("G", today(30), {
        route: { name: "card", host: "h-gone", projectId: "p", cardId: "c" },
      }),
      ENTRY("B", today(20)),
    ]);
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: w.dismiss("Session G") }));
    });
    expect(said(panel)).toBe(w.dismissed("Session G"));
    expect(document.activeElement?.textContent).toContain("Session B");
    expect(pickOf(panel, document.activeElement)).toBe(true);
  });

  test("a row of an earlier day shows its day, a row of today only its time", async () => {
    const old = daysAgo(3);
    const panel = await openPanel(lang, [ENTRY("N", today(30)), ENTRY("O", old)]);
    const time = (title: string) => rowOf(panel, title).querySelector(".inbox-time")?.textContent;
    expect(time("Session O")).toBe(formatWhen(old, Date.now(), lang));
    expect(time("Session O")).not.toBe(formatWhen(old, Date.parse(old), lang));
    expect(time("Session N")).toBe(formatWhen(today(30), Date.now(), lang));
    expect(time("Session N")).not.toBe(time("Session O"));
  });
});
