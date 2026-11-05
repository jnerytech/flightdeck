import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(5000);
const fill = (text: string, host: string) => text.replace("{host}", host);

/** The reader opened on `claudeSessionId` of a host named alfa, live or with nothing answering. */
async function openReader(lang: "en" | "pt-BR", claudeSessionId: string, live: boolean) {
  const store = new AppStore(memoryPlatform(false, lang).platform, {
    baseDelayMs: 60_000,
    wakeDebounceMs: 0,
  });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const url = live ? makeDaemon(cleanups).listen().url : "ws://127.0.0.1:1/v1/ws";
  await act(() => store.addHost({ name: "alfa", url, token: TOKEN }));
  await settle(() =>
    live
      ? store.getState().hosts[0]?.status === "online"
      : store.getState().hosts[0]?.retry != null,
  );
  const hostId = store.getState().hosts[0]?.id ?? "";
  await act(async () => {
    store.router.push({ name: "reader", target: { hostId, claudeSessionId } });
  });
  return store;
}

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`reader-states (${lang}): the reader says what happened to the session`, () => {
    // Issue #227 (OpenCode R6): a session the host no longer has showed "New session" over an
    // empty pane, with no reason and no way on.
    test("a session the host does not have says so and leads back to the sessions", async () => {
      const store = await openReader(lang, "no-such-session", true);
      await settle(() =>
        (document.body.textContent ?? "").includes(fill(t.reader.missing, "alfa")),
      );
      const back = screen.queryByRole("button", { name: t.reader.back });
      expect(back).not.toBeNull();
      await act(async () => {
        fireEvent.click(back as HTMLElement);
      });
      expect(store.router.current.name).toBe("hub");
    });

    test("a read that fails on a live host says so, and Try again reads again", async () => {
      const store = await openReader(lang, "no-such-session", true);
      await settle(() =>
        (document.body.textContent ?? "").includes(fill(t.reader.missing, "alfa")),
      );
      // From here on the host answers every read with an error that is not "not found".
      // The store reads through historyGet, which says why a read was refused.
      let reads = 0;
      store.historyGet = (async (_host, _id, _cursor, _tail, refused) => {
        reads++;
        refused?.("internal");
        return null;
      }) as typeof store.historyGet;
      const id = store.getState().hosts[0]?.id ?? "";
      await act(async () => {
        store.router.push({ name: "reader", target: { hostId: id, claudeSessionId: "other" } });
      });
      await settle(() => screen.queryByRole("button", { name: t.reader.retry }) !== null);
      expect(document.body.textContent ?? "").toContain(fill(t.reader.failed, "alfa"));
      await act(async () => {
        fireEvent.click(screen.queryByRole("button", { name: t.reader.retry }) as HTMLElement);
      });
      await settle(() => reads === 2);
    });

    // A screen of a host that does not answer waited on "connecting" forever: after a failed try
    // it says the host is offline, why, and offers to reconnect.
    test("a host that does not answer: the screen says it is offline, with Reconnect now", async () => {
      await openReader(lang, "any-session", false);
      await settle(() => screen.queryByRole("region", { name: t.hostOffline.label }) !== null);
      const banner = screen.queryByRole("region", { name: t.hostOffline.label }) as HTMLElement;
      expect(banner.textContent ?? "").toContain(t.hostOffline.title);
      expect(
        within(banner).queryByRole("button", { name: t.hostOffline.reconnectNow }),
      ).not.toBeNull();
    });
  });
}
