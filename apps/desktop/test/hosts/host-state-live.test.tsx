import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../../src/i18n/en.ts";
import { translator } from "../../src/i18n/index.ts";
import { ptBR } from "../../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TContext } = await import("../../src/i18n/context.tsx");
const { HostStateLive } = await import("../../src/features/hosts/host-state-live.tsx");

afterEach(cleanup);

const host = (status: "online" | "offline" | "connecting") =>
  ({ id: "h1", name: "alfa", status, hostInfo: null }) as never;

const page = (lang: "en" | "pt-BR", status: "online" | "offline" | "connecting") => (
  <TContext.Provider value={translator(lang)}>
    <HostStateLive host={host(status)} />
  </TContext.Provider>
);

const region = () => screen.queryByRole("status") as HTMLElement | null;

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  describe(`host-state-live (${lang}): a host that drops under its open page is announced (#4501)`, () => {
    test("it names the host and its new state when the state changes", () => {
      const view = render(page(lang, "online"));
      const before = region();
      view.rerender(page(lang, "offline"));
      expect(region()).toBe(before);
      expect(region()?.textContent).toBe(`alfa: ${t.hosts.status.offline}`);
      view.rerender(page(lang, "connecting"));
      expect(region()?.textContent).toBe(`alfa: ${t.hosts.status.connecting}`);
    });
  });
}
