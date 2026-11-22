import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../../src/i18n/en.ts";
import { ptBR } from "../../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { waiter } from "../wait.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(4000);

const DEAD = "ws://127.0.0.1:1/v1/ws";

/** The page of a host nothing answers for; the retry is far away, so the page holds still. */
async function awayPage(lang: "en" | "pt-BR") {
  const store = new AppStore(memoryPlatform(false, lang).platform, {
    baseDelayMs: 60_000,
    wakeDebounceMs: 0,
  });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(() => store.roster.add({ name: "pc", url: DEAD, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.retry != null);
  const id = store.getState().hosts[0]?.id ?? "";
  await act(async () => {
    store.router.push({ name: "host", host: id });
  });
  await settle(() => screen.queryByRole("heading", { name: "pc" }) !== null);
  return store;
}

const asStatus = (store: InstanceType<typeof AppStore>, status: string) =>
  act(async () => {
    const host = store.getState().hosts[0];
    (store as unknown as { update(patch: object): void }).update({
      hosts: [{ ...host, status }],
    });
  });

/** The text a control's aria-describedby points to. */
function described(control: HTMLElement | null): string {
  const ids = control?.getAttribute("aria-describedby")?.split(" ") ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`host-away-ui (${lang}): a host that does not answer does not claim it has no sessions (issue #3786)`, () => {
    test("an offline host's Sessions and Projects panels say the lists show once it answers, and New session says why it is off", async () => {
      await awayPage(lang);
      const page = document.body.textContent ?? "";
      expect(page).toContain(t.hostHome.noSessionsAway.replace("{host}", "pc"));
      expect(page).toContain(t.hostHome.noProjectsAway.replace("{host}", "pc"));
      expect(page).not.toContain(t.hostHome.noSessions);
      expect(page).not.toContain(t.hostHome.noProjects);
      const button = screen.queryByRole("button", {
        name: t.hostHome.newSession,
      }) as HTMLButtonElement | null;
      expect([button !== null, button?.disabled]).toEqual([true, true]);
      expect(described(button)).toContain(t.hostPage.needsOnline.replace("{host}", "pc"));
    });

    test("New session's reason is a line in the panel, not a box hanging off the button, so it cannot run past the card (issue #3862)", async () => {
      const store = await awayPage(lang);
      const seen: Array<{ status: string; hangs: boolean }> = [];
      for (const [status, reason] of [
        ["offline", t.hostPage.needsOnline],
        ["incompatible", t.hostPage.needsUpdate],
        ["connecting", t.hostPage.needsConnection],
        ["unauthorized", t.hostOffline.unauthorized],
      ] as const) {
        await asStatus(store, status);
        const button = screen.getByRole("button", { name: t.hostHome.newSession });
        const id = button.getAttribute("aria-describedby") ?? "";
        const line = document.getElementById(id);
        // `action-reason` is positioned absolute from the button's left edge: past the right column it is cut off.
        const hangs =
          line === null ||
          line.className.includes("action-reason") ||
          button.parentElement?.className.includes("action-button-box") === true;
        seen.push({ status, hangs });
        expect(described(button)).toContain(reason.replace("{host}", "pc"));
      }
      expect(seen.map((row) => [row.status, row.hangs])).toEqual([
        ["offline", false],
        ["incompatible", false],
        ["connecting", false],
        ["unauthorized", false],
      ]);
    });

    test("an online host's New session is on and has no reason line (issue #3862)", async () => {
      const store = await awayPage(lang);
      await asStatus(store, "online");
      const button = screen.getByRole("button", { name: t.hostHome.newSession });
      expect([
        (button as HTMLButtonElement).disabled,
        button.hasAttribute("aria-describedby"),
      ]).toEqual([false, false]);
    });

    test("an incompatible host's Information panel names the other version, a refused token names the token", async () => {
      const store = await awayPage(lang);
      await asStatus(store, "incompatible");
      expect(document.body.textContent).toContain(t.hostPage.unavailableIncompatible);
      await asStatus(store, "unauthorized");
      expect(document.body.textContent).toContain(t.hostPage.unavailableUnauthorized);
      expect(document.body.textContent).not.toContain(t.hostPage.unavailable);
    });
  });
}
