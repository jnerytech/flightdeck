import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(4000);

const DEAD = "ws://127.0.0.1:1/v1/ws";

/** The page of a host nothing answers for. The automatic retry is far away, so the page holds still. */
async function offlinePage(lang: "en" | "pt-BR") {
  const store = new AppStore(memoryPlatform(false, lang).platform, {
    baseDelayMs: 60_000,
    wakeDebounceMs: 0,
  });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(() => store.addHost({ name: "pc", url: DEAD, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.retry != null);
  const id = store.getState().hosts[0]?.id ?? "";
  await act(async () => {
    store.router.push({ name: "host", host: id });
  });
  await settle(() => screen.queryByRole("heading", { name: "pc" }) !== null);
}

/** The text a control's aria-describedby points to. */
function described(control: HTMLElement | null): string {
  const ids = control?.getAttribute("aria-describedby")?.split(" ") ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`host-offline-actions (${lang}): an offline host's page offers nothing that cannot work`, () => {
    // Issue #181: the hooks buttons and the folder field stayed live, and Add said "type the folder".
    test("the hooks buttons are off and say the host is offline", async () => {
      await offlinePage(lang);
      const reason = t.hostPage.needsOnline.replace("{host}", "pc");
      for (const name of [t.hostPage.install, t.hostPage.uninstall]) {
        const button = screen.queryByRole("button", { name }) as HTMLButtonElement | null;
        expect([name, button?.disabled]).toEqual([name, true]);
        expect(described(button)).toContain(reason);
      }
    });

    test("the allowed folder field is off, and Add gives the offline reason, not 'type the folder'", async () => {
      await offlinePage(lang);
      const reason = t.hostPage.needsOnline.replace("{host}", "pc");
      const input = screen.queryByLabelText(t.hostPage.rootsInput) as HTMLInputElement | null;
      expect(input?.disabled).toBe(true);
      const add = screen.queryByRole("button", { name: t.toast.allowRoot }) as HTMLElement | null;
      expect(described(add)).toContain(reason);
      expect(described(add)).not.toContain(t.hostPage.rootsNeeded);
    });
  });
}
