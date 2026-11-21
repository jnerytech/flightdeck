import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, seedHosts } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { PluginsPage } = await import("../../src/features/plugins/page.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);

type Lang = "en" | "pt-BR";

const WORDS = {
  en: {
    noHost: "No online host keeps plugins. Bring a host that has them online to see them here.",
    failed: "Could not read this host's plugins.",
    retry: "Try again",
    pin: "Pin version deploy-tools",
    none: "No plugin installed.",
  },
  "pt-BR": {
    noHost: "Nenhum host online guarda plugins. Ligue um host que os tenha para vê-los aqui.",
    failed: "Não foi possível ler os plugins deste host.",
    retry: "Tentar de novo",
    pin: "Fixar versão deploy-tools",
    none: "Nenhum plugin instalado.",
  },
} as const;

const PLUGIN = {
  id: "deploy-tools@acme",
  name: "deploy-tools",
  marketplace: "acme",
  version: "1.2.0",
  scope: "user",
  enabled: true,
  path: "/p/deploy-tools",
  pinned: null,
  inventory: null,
  errors: [],
};
const LIST = { installed: [PLUGIN], available: [], marketplaces: [] };

/** The command types asked, in order. */
type Asked = Array<{ type: string; options: unknown }>;

/**
 * The page on a store whose commands answer as `answer` says: a value, or `null` for a refusal.
 * `online`: whether the one host that keeps plugins is online.
 */
async function page(lang: Lang, online: boolean, answer: (type: string, nth: number) => unknown) {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await store.i18n.setLang(lang);
  seedHosts(store, [{ id: "h1", name: "pc", online, features: ["plugins"] }]);
  const asked: Asked = [];
  store.hostCommand = (async (
    _host: string,
    type: string,
    _payload: unknown,
    options?: unknown,
  ) => {
    asked.push({ type, options });
    return answer(type, asked.filter((a) => a.type === type).length);
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <PluginsPage store={store} />
    </TContext.Provider>,
  );
  await act(async () => {});
  return { asked, store };
}

describe.each(["en", "pt-BR"] as const)("the Plugins page states (%s)", (lang) => {
  const w = WORDS[lang];
  const click = (name: string) =>
    act(async () => {
      fireEvent.click(screen.queryByRole("button", { name }) as HTMLElement);
    });

  test("with no online host that keeps plugins, it says so instead of loading for ever", async () => {
    await page(lang, false, () => LIST);
    expect(screen.queryByText(w.noHost) !== null).toBe(true);
  });

  test("a refused list is an error with Try again, not three empty lists", async () => {
    let refuse = true;
    await page(lang, true, () => (refuse ? null : LIST));
    expect(screen.queryByRole("alert")?.textContent?.includes(w.failed)).toBe(true);
    expect(screen.queryByText(w.none) === null).toBe(true);
    refuse = false;
    await click(w.retry);
    await settle(() => screen.queryByText("deploy-tools") !== null);
    expect(screen.queryByRole("alert") === null).toBe(true);
  });

  test("a refused refresh after an action keeps the list and offers Try again, which refreshes it", async () => {
    const { asked } = await page(lang, true, (type, nth) => {
      if (type === "plugins.list") return nth === 2 ? null : LIST;
      return {};
    });
    await settle(() => screen.queryByText("deploy-tools") !== null);
    await click(w.pin);
    await settle(() => screen.queryByRole("alert") !== null);
    expect(screen.queryByText("deploy-tools") !== null).toBe(true);
    expect(screen.queryByText(w.none) === null).toBe(true);
    await click(w.retry);
    await settle(() => screen.queryByRole("alert") === null);
    expect(screen.queryByText("deploy-tools") !== null).toBe(true);
    // The page has its own Try again, so no toast retry (it would drop the answer).
    const loads = asked.filter((a) => a.type === "plugins.list");
    expect(loads.every((a) => JSON.stringify(a.options) === '{"retry":false}')).toBe(true);
  });
});
