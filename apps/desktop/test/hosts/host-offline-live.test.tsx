import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../../src/i18n/en.ts";
import { translator } from "../../src/i18n/index.ts";
import { ptBR } from "../../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../../src/i18n/context.tsx");
const { HostOfflineBanner } = await import("../../src/features/hosts/host-offline-banner.tsx");

afterEach(cleanup);

/** A host nothing answers for: `lastTryAt` moves with each try, the status says whether one runs. */
function host(status: "offline" | "connecting", lastTryAt: number) {
  return {
    id: "h1",
    name: "pc",
    url: "ws://10.0.0.5:7420/v1/ws",
    status,
    retry: { kind: "refused", lastTryAt, nextRetryAt: lastTryAt + 60_000 },
    hostInfo: null,
  } as never;
}

function page(lang: "en" | "pt-BR", state: ReturnType<typeof host>) {
  return (
    <TContext.Provider value={translator(lang)}>
      <HostOfflineBanner host={state} onReconnect={() => {}} />
    </TContext.Provider>
  );
}

const status = () => screen.queryByRole("status") as HTMLElement | null;

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`host-offline-live (${lang}): the result of Reconnect now is announced (issue #2586)`, () => {
    test("one status region is there before the press, so the later text is announced", () => {
      render(page(lang, host("offline", 1_000)));
      expect(status()).not.toBeNull();
      // An <output> element: it carries the status role by itself (Sonar S6819).
      expect([status()?.tagName, status()?.textContent]).toEqual(["OUTPUT", ""]);
    });

    test("the region says the host is connecting while the try runs", async () => {
      const view = render(page(lang, host("offline", 1_000)));
      const region = status();
      await act(async () => {
        fireEvent.click(
          screen.queryByRole("button", { name: t.hostOffline.reconnectNow }) as HTMLElement,
        );
      });
      view.rerender(page(lang, host("connecting", 1_000)));
      expect(status()).toBe(region);
      expect(status()?.textContent).toBe(t.hostOffline.connecting);
    });

    test("the same region says the host is still offline once the try failed", async () => {
      const view = render(page(lang, host("offline", 1_000)));
      const region = status();
      await act(async () => {
        fireEvent.click(
          screen.queryByRole("button", { name: t.hostOffline.reconnectNow }) as HTMLElement,
        );
      });
      view.rerender(page(lang, host("connecting", 1_000)));
      view.rerender(page(lang, host("offline", 2_000)));
      expect(status()).toBe(region);
      expect(status()?.textContent).toBe(t.hostOffline.still);
    });

    test("the countdown to the next automatic try stays out of the live region", () => {
      render(page(lang, host("offline", 1_000)));
      const countdown = screen.queryByText(
        new RegExp(t.hostOffline.nextTry.replace("{n}", "\\d+")),
      );
      expect(countdown).not.toBeNull();
      expect(status()).not.toBeNull();
      expect(status()?.contains(countdown)).toBe(false);
    });
  });
}
