import { describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";
import { settle, stays } from "./wait.ts";

registerDom();
const { runPaletteTarget } = await import("../src/ui/App.tsx");
type Store = Parameters<typeof runPaletteTarget>[0];
type Target = Parameters<typeof runPaletteTarget>[1];
type Route = Parameters<Parameters<typeof runPaletteTarget>[2]["go"]>[0];

/** A store that writes down what it was asked, and a view that does the same. */
function recorder(
  opts: {
    embedded?: boolean;
    link?: Route | null;
    answers?: Record<string, unknown>;
    persona?: string;
    ref?: unknown;
    prefs?: { mode: string; model: string };
  } = {},
) {
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
    hostCommand: (host: string, type: string, payload: unknown) => {
      calls.push(`${host} ${type} ${JSON.stringify(payload)}`);
      return Promise.resolve(opts.answers?.[type] ?? null);
    },
    decideOldest: (decision: string, key: string) => void calls.push(`decide ${decision} ${key}`),
    createSession: (host: string, payload: unknown) => {
      calls.push(`create ${host} ${JSON.stringify(payload)}`);
      return Promise.resolve("s1");
    },
    newSessionPrefs: { value: opts.prefs ?? { mode: "default", model: "", folders: {} } },
    clientScope: () => ({ defaultPersona: () => opts.persona ?? "" }),
    personaRef: () => opts.ref ?? null,
    getState: () => ({ cards: {}, projects: {} }),
  } as unknown as Store;
  const ui = (lang = "pt-BR") => ({
    lang,
    go: (route: Route) => void calls.push(`go ${JSON.stringify(route)}`),
    showHelp: () => void calls.push("help"),
    askStart: (_card: unknown, _contracts: unknown, go: () => void) => go(),
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

  test("an issue named by its number becomes a card through its reference, and its board opens", async () => {
    const r = recorder({
      answers: { "issues.get": { ref: "o/r#123" }, "issues.createCard": { id: "c" } },
    });
    const target = { kind: "create-card-issue", hostId: "h", projectId: "p", id: "123" } as const;
    run(r.store, target, r.ui());
    await settle(() => r.calls.length === 3, 2000, "the board after the card");
    expect(r.calls).toEqual([
      'h issues.get {"projectId":"p","id":"123"}',
      'h issues.createCard {"projectId":"p","issueRef":"o/r#123"}',
      'go {"name":"board","host":"h","projectId":"p"}',
    ]);
  });

  test("an issue the host does not find, or one with neither reference nor number, makes no card", async () => {
    const lost = recorder();
    run(lost.store, { kind: "create-card-issue", hostId: "h", projectId: "p", id: "9" }, lost.ui());
    const blank = recorder();
    run(blank.store, { kind: "create-card-issue", hostId: "h", projectId: "p" }, blank.ui());
    await stays(() => lost.calls.length === 1 && blank.calls.length === 0, 100, "no card");
    expect(lost.calls).toEqual(['h issues.get {"projectId":"p","id":"9"}']);
    expect(blank.calls).toEqual([]);
  });

  test("any other entry is a screen: the view goes to its route", () => {
    const r = recorder();
    run(r.store, { kind: "costs" }, r.ui());
    expect(r.calls).toEqual(['go {"name":"costs"}']);
  });
});

describe("palette-target: Start in <project> (issue #1135)", () => {
  const target = {
    kind: "start-session",
    hostId: "h1",
    cwd: "/work/api",
    prompt: "fix it",
  } as const;

  test("a session starts in the project's folder with the text as its prompt, in the default mode", () => {
    const { calls, store, ui } = recorder();
    run(store, target, ui());
    expect(calls).toEqual([
      'create h1 {"cwd":"/work/api","prompt":"fix it","permissionMode":"default"}',
    ]);
  });

  test("it starts in the mode and the model the New session form last used", () => {
    const { calls, store, ui } = recorder({ prefs: { mode: "plan", model: "opus" } });
    run(store, target, ui());
    expect(calls).toEqual([
      'create h1 {"cwd":"/work/api","prompt":"fix it","permissionMode":"plan","model":"opus"}',
    ]);
  });

  test("the client's default persona for that folder goes with it, as on the form", () => {
    const ref = { kind: "host", id: "arq" };
    const { calls, store, ui } = recorder({ persona: "host:arq", ref });
    run(store, target, ui());
    expect(calls).toEqual([
      `create h1 {"cwd":"/work/api","prompt":"fix it","permissionMode":"default","persona":${JSON.stringify(ref)}}`,
    ]);
  });
});
