import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { RequestError } from "../../src/features/hosts/host-connection.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { interceptWire } from "../fake-host.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle, uiIdle } from "../wait.ts";
import { snippetsHost } from "./ui-setup.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

type Intercept = (type: string, payload: unknown, next: () => Promise<unknown>) => Promise<unknown>;

/** The Snippets screen over a real daemon with `eco` and `status`; the wire goes through `intercept`, which can be swapped. */
async function open(language: "en" | "pt-BR", names: string[] = ["eco", "status"]) {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await snippetsHost(cleanups, store);
  for (const name of names) await h.save({ name, type: "command", run: `echo ${name}` });
  const hooks: { intercept: Intercept } = { intercept: (_type, _payload, next) => next() };
  render(<App store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Snippets" }) !== null);
  // The app starts its own connection to the host: break the wire of the one it keeps.
  await settle(() => store.getState().hosts[0]?.status === "online");
  interceptWire(store, h.hostId, (type, payload, next) => hooks.intercept(type, payload, next));
  return { store, hooks, ...h };
}

const goToSnippets = async () => {
  await act(async () => {
    fireEvent.click(screen.queryByRole("button", { name: "Snippets" }) as HTMLElement);
  });
};
const rowNames = () => {
  const list = screen.queryByRole("list", { name: "Snippets" });
  return list
    ? within(list)
        .queryAllByRole("listitem")
        .map((r) => r.querySelector("[data-name]")?.textContent ?? "")
    : [];
};
const type = async (label: string, value: string) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
};
const refuse: Intercept = (type, _payload, next) =>
  type === "snippets.list" ? Promise.reject(new RequestError("bad_thing", "No room left")) : next();
/** Waits until the page has taken in what it was just answered, so a check on its screen looks at the settled one. */
const afterAnswer = () => uiIdle();

const WORDS = {
  en: {
    empty: "No snippet.",
    loading: "Loading snippets",
    failed: "Could not read this host's snippets.",
    retry: "Try again",
    search: "Search snippet",
  },
  "pt-BR": {
    empty: "Nenhum snippet.",
    loading: "Carregando snippets",
    failed: "Não foi possível ler os snippets deste host.",
    retry: "Tentar de novo",
    search: "Buscar snippet",
  },
} as const;

// Issue #3969: the list says it is loading, says when the host refused it (with a way to try again)
// and only hears the answer of the latest read.
describe.each(["en", "pt-BR"] as const)("snippets-ui: the list's states (%s)", (language) => {
  const w = WORDS[language];

  test("while the host has not answered the list, a loading state shows and not the empty one", async () => {
    const d = await open(language);
    let asked = false;
    d.hooks.intercept = (type, _payload, next) => {
      if (type !== "snippets.list") return next();
      asked = true;
      return new Promise(() => {});
    };
    await goToSnippets();
    await settle(() => asked);
    await afterAnswer();
    expect(screen.queryByRole("status", { name: w.loading })).not.toBeNull();
    expect(screen.queryByText(w.empty)).toBeNull();
  });

  test("a refused list says so with a retry, and the retry shows the list", async () => {
    const d = await open(language);
    let refused = 0;
    d.hooks.intercept = (type, payload, next) => {
      if (type === "snippets.list") refused++;
      return refuse(type, payload, next);
    };
    await goToSnippets();
    await settle(() => refused > 0);
    await afterAnswer();
    expect(screen.queryByText(w.failed)).not.toBeNull();
    expect(screen.queryByText(w.empty)).toBeNull();
    d.hooks.intercept = (_type, _payload, next) => next();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: w.retry }));
    });
    await settle(() => rowNames().length === 2);
    expect(screen.queryByText(w.failed)).toBeNull();
  });

  test("a refused read after a filter change does not leave the old list as if it matched", async () => {
    const d = await open(language);
    await goToSnippets();
    await settle(() => rowNames().length === 2);
    let refused = 0;
    d.hooks.intercept = (type, payload, next) => {
      if (type === "snippets.list") refused++;
      return refuse(type, payload, next);
    };
    await type(w.search, "sta");
    await settle(() => refused > 0);
    await afterAnswer();
    expect(screen.queryByText(w.failed)).not.toBeNull();
    expect(rowNames()).toEqual([]);
  });

  test("an older read that answers last does not replace the newer list", async () => {
    const d = await open(language, ["alfa", "abacate"]);
    await goToSnippets();
    await settle(() => rowNames().length === 2);
    let delivered = false;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    d.hooks.intercept = async (wire, payload, next) => {
      if (wire !== "snippets.list" || (payload as { query?: string }).query !== "a") return next();
      const answer = await next();
      await gate;
      delivered = true;
      return answer;
    };
    await type(w.search, "a");
    await type(w.search, "ab");
    await settle(() => rowNames().join() === "abacate");
    release();
    await settle(() => delivered);
    await afterAnswer();
    expect(rowNames()).toEqual(["abacate"]);
  });
});
