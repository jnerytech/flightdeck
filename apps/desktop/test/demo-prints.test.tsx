import { afterEach, describe, expect, test } from "bun:test";
import {
  applyDemoPrefs,
  entryHtml,
  initialRoute,
  parseDemoHosts,
  seedDemoHosts,
} from "../src/demo/boot.ts";
import { LANG_KEY } from "../src/i18n/index.ts";
import { loadHosts } from "../src/lib/hosts.ts";
import { THEME_KEY } from "../src/lib/theme.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { createWebPlatform } = await import("../src/platform/web/index.ts");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const HOST = { id: "demo-alfa", name: "alfa", url: "ws://127.0.0.1:7777/v1/ws", token: TOKEN };

describe("demo-prints", () => {
  test("a entrada web recebe os hosts do demo e os guarda já pareados, com os tokens", () => {
    expect(parseDemoHosts(JSON.stringify([HOST]))).toEqual([HOST]);
    expect(parseDemoHosts(undefined)).toEqual([]);
    expect(parseDemoHosts("não é json")).toEqual([]);
    expect(parseDemoHosts(JSON.stringify([{ name: "sem url" }]))).toEqual([]);
    const { platform } = memoryPlatform();
    const secrets = new Map<string, string>();
    seedDemoHosts(platform.storage, secrets, [HOST]);
    expect(loadHosts(platform.storage)).toEqual([
      { id: "demo-alfa", name: "alfa", url: "ws://127.0.0.1:7777/v1/ws" },
    ]);
    expect(secrets.get("demo-alfa")).toBe(TOKEN);
  });

  test("o app do demo abre já conectado ao host semeado, sem passar pelo formulário", async () => {
    const d = makeDaemon(cleanups);
    const url = d.listen().url;
    const mem = memoryPlatform();
    const secrets = new Map<string, string>();
    seedDemoHosts(mem.win.localStorage, secrets, [{ ...HOST, url }]);
    const store = new AppStore(createWebPlatform(mem.win, secrets), { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await settle(() => store.getState().hosts[0]?.status === "online");
    expect(store.getState().hosts.map((h) => [h.id, h.status])).toEqual([["demo-alfa", "online"]]);
    expect(
      screen.queryByText("Adicione um host com o endereço e o token do flightdeckd."),
    ).toBeNull();
  });

  test("o endereço do demo escolhe a tela, o tema e o idioma de cada print", () => {
    const route = { name: "session", host: "demo-alfa", id: "s1" } as const;
    expect(initialRoute(`?route=${encodeURIComponent(JSON.stringify(route))}`)).toEqual(route);
    expect(initialRoute("")).toBeNull();
    expect(initialRoute("?route=%7Bquebrado")).toBeNull();
    expect(initialRoute(`?route=${encodeURIComponent(JSON.stringify({ name: 3 }))}`)).toBeNull();
    const { platform, items } = memoryPlatform();
    applyDemoPrefs(platform.storage, "?theme=dark&lang=en");
    expect(items.get(THEME_KEY)).toBe("dark");
    expect(items.get(LANG_KEY)).toBe("en");
    applyDemoPrefs(platform.storage, "?theme=roxo&lang=fr");
    expect(items.get(THEME_KEY)).toBe("dark");
    expect(items.get(LANG_KEY)).toBe("en");
  });

  test("FLIGHTDECK_ENTRY=web troca a entrada do index.html pela web", () => {
    const html = '<script type="module" src="/src/main.tsx"></script>';
    expect(entryHtml(html, "web")).toBe('<script type="module" src="/src/main.web.tsx"></script>');
    expect(entryHtml(html, undefined)).toBe(html);
    expect(entryHtml(html, "tauri")).toBe(html);
  });
});
