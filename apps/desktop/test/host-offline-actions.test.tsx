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
  return store;
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

    test("an incompatible host's folder row asks to update its daemon, not to reconnect", async () => {
      const store = await offlinePage(lang);
      await act(async () => {
        const host = store.getState().hosts[0];
        (store as unknown as { update(patch: object): void }).update({
          hosts: [{ ...host, status: "incompatible" }],
        });
      });
      const add = screen.queryByRole("button", { name: t.toast.allowRoot }) as HTMLElement | null;
      expect(described(add)).toContain(t.hostPage.needsUpdate.replace("{host}", "pc"));
      expect(described(add)).not.toContain(t.hostPage.needsOnline.replace("{host}", "pc"));
    });

    test("an incompatible host leads with a sentence of the catalog; the daemon's own words are under Details", async () => {
      const store = await offlinePage(lang);
      await act(async () => {
        const host = store.getState().hosts[0];
        (store as unknown as { update(patch: object): void }).update({
          hosts: [{ ...host, status: "incompatible", incompatibility: "protocolo 1 apenas" }],
        });
      });
      const page = document.body.textContent ?? "";
      expect(page).toContain(t.errors.protocol_incompatible);
      const raw = [...document.querySelectorAll("details")].find((d) =>
        (d.textContent ?? "").includes("protocolo 1 apenas"),
      );
      expect(raw?.querySelector("summary")?.textContent).toBe(t.toast.details);
    });

    // OpenCode branch review m1, m2: a refused token and a first connection are not "offline".
    test("a refused token asks to pair again, and a host still connecting says so, in the folder row and the hooks", async () => {
      const store = await offlinePage(lang);
      const as = async (status: string) =>
        act(async () => {
          const host = store.getState().hosts[0];
          (store as unknown as { update(patch: object): void }).update({
            hosts: [{ ...host, status }],
          });
        });
      const add = () =>
        screen.queryByRole("button", { name: t.toast.allowRoot }) as HTMLElement | null;
      const install = () =>
        screen.queryByRole("button", { name: t.hostPage.install }) as HTMLElement | null;
      await as("unauthorized");
      expect(described(add())).toContain(t.hostOffline.unauthorized);
      expect(described(install())).toContain(t.hostOffline.unauthorized);
      await as("connecting");
      expect(described(add())).toContain(t.hostPage.needsConnection.replace("{host}", "pc"));
      expect(described(install())).toContain(t.hostPage.needsConnection.replace("{host}", "pc"));
    });

    // OpenCode branch review m4: the notice said the same thing twice.
    test("an incompatible host's notice says what is wrong once", async () => {
      const store = await offlinePage(lang);
      await act(async () => {
        const host = store.getState().hosts[0];
        (store as unknown as { update(patch: object): void }).update({
          hosts: [{ ...host, status: "incompatible", incompatibility: "protocolo 1 apenas" }],
        });
      });
      const notice = document.querySelector("main")?.textContent ?? "";
      expect(notice).toContain(t.errors.protocol_incompatible);
      expect(notice).not.toContain(t.hostPage.incompatible);
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
