import { describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
const { runPaletteTarget } = await import("../src/ui/App.tsx");
type Store = Parameters<typeof runPaletteTarget>[0];
type Target = Parameters<typeof runPaletteTarget>[1];
type Route = Parameters<Parameters<typeof runPaletteTarget>[2]["go"]>[0];

/** A store that writes down what it was asked, and a view that does the same. */
function recorder(opts: { embedded?: boolean; link?: Route | null } = {}) {
  const calls: string[] = [];
  const store = {
    embeddedTerminal: () => opts.embedded ?? false,
    openClaudeHere: (host: string) => void calls.push(`claude-here ${host}`),
    openInTerminal: (host: string) => void calls.push(`terminal ${host}`),
    openTerminal: (host: string) => void calls.push(`new-terminal ${host}`),
    theme: { toggle: () => void calls.push("theme") },
    toggleUiMode: () => void calls.push("ui-mode"),
    i18n: { setLang: (lang: string) => void calls.push(`lang ${lang}`) },
    setClientSelection: (id: string) => void calls.push(`client ${id}`),
    chooseSnippet: (c: { hostId: string; snippetId: string }) =>
      void calls.push(`snippet ${c.hostId}/${c.snippetId}`),
    openPrLink: (url: string) => {
      calls.push(`pr ${url}`);
      return Promise.resolve(opts.link ?? null);
    },
    hostCommand: (host: string, type: string, payload: unknown) =>
      void calls.push(`${host} ${type} ${JSON.stringify(payload)}`),
    decideOldest: (decision: string, key: string) => void calls.push(`decide ${decision} ${key}`),
  } as unknown as Store;
  const ui = (lang = "pt-BR") => ({
    lang,
    go: (route: Route) => void calls.push(`go ${JSON.stringify(route)}`),
    showHelp: () => void calls.push("help"),
  });
  return { calls, store, ui };
}

const run = (store: Store, target: Target, ui: ReturnType<ReturnType<typeof recorder>["ui"]>) =>
  runPaletteTarget(store, target, ui);

describe("palette-target: what a palette entry does in place", () => {
  test("a terminal opens Claude here when the host has an embedded terminal, else the machine's", () => {
    const here = recorder({ embedded: true });
    run(
      here.store,
      { kind: "terminal", hostId: "h", target: { kind: "claude" } as never },
      here.ui(),
    );
    const away = recorder({ embedded: false });
    run(
      away.store,
      { kind: "terminal", hostId: "h", target: { kind: "claude" } as never },
      away.ui(),
    );
    expect(here.calls).toEqual(["claude-here h"]);
    expect(away.calls).toEqual(["terminal h"]);
  });

  test("a new terminal, the theme, the simple mode and the client switch go to the store", () => {
    const r = recorder();
    run(r.store, { kind: "new-terminal", hostId: "h" }, r.ui());
    run(r.store, { kind: "toggle-theme" }, r.ui());
    run(r.store, { kind: "toggle-ui-mode" }, r.ui());
    run(r.store, { kind: "switch-client", clientId: "c1" }, r.ui());
    expect(r.calls).toEqual(["new-terminal h", "theme", "ui-mode", "client c1"]);
  });

  test("the language switches to the other one", () => {
    const pt = recorder();
    run(pt.store, { kind: "switch-language" }, pt.ui("pt-BR"));
    const en = recorder();
    run(en.store, { kind: "switch-language" }, en.ui("en"));
    expect(pt.calls).toEqual(["lang en"]);
    expect(en.calls).toEqual(["lang pt-BR"]);
  });

  test("a snippet is chosen, a card is started, the sheet of shortcuts is shown", () => {
    const r = recorder();
    run(r.store, { kind: "snippet", hostId: "h", snippetId: "s" } as never, r.ui());
    run(r.store, { kind: "start-card", hostId: "h", cardId: "c" }, r.ui());
    run(r.store, { kind: "shortcuts" }, r.ui());
    expect(r.calls).toEqual(["snippet h/s", 'h card.start {"cardId":"c"}', "help"]);
  });

  test("the oldest request is decided with the key the command named", () => {
    const r = recorder();
    run(r.store, { kind: "decide-oldest", decision: "deny", key: "h/r1" }, r.ui());
    expect(r.calls).toEqual(["decide deny h/r1"]);
  });

  test("a pull request link opens the route the store finds, and nothing when it finds none", async () => {
    const found = recorder({ link: { name: "hub" } as Route });
    run(found.store, { kind: "pull-link", url: "https://x/pr/1" } as never, found.ui());
    const none = recorder({ link: null });
    run(none.store, { kind: "pull-link", url: "https://x/pr/2" } as never, none.ui());
    await Promise.resolve();
    await Promise.resolve();
    expect(found.calls).toEqual(["pr https://x/pr/1", 'go {"name":"hub"}']);
    expect(none.calls).toEqual(["pr https://x/pr/2"]);
  });

  test("any other entry is a screen: the view goes to its route", () => {
    const r = recorder();
    run(r.store, { kind: "costs" }, r.ui());
    expect(r.calls).toEqual(['go {"name":"costs"}']);
  });
});
