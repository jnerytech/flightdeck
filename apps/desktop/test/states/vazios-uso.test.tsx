import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "../dom.ts";
import { uiIdle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { TContext } = await import("../../src/i18n/context.tsx");
const { translator } = await import("../../src/i18n/index.ts");
const { UsagePanel } = await import("../../src/features/costs/usage-panel.tsx");

import type { AppStore } from "../../src/lib/app-store.ts";

afterEach(cleanup);

const EMPTY = {
  en: "No usage in the last 7 days. The cost appears here after a session has run on this host.",
  "pt-BR":
    "Nenhum uso nos últimos 7 dias. O custo aparece aqui depois que uma sessão rodar neste host.",
};

/** A store whose `costs.summary` answers `summary` (a never-settling answer when `pending`). */
function fakeStore(summary: unknown, pending = false) {
  return {
    today: () => "2026-11-01",
    hostCommand: (_host: string, _command: string) =>
      pending ? new Promise(() => {}) : Promise.resolve(summary),
  } as unknown as AppStore;
}

function panel(language: "en" | "pt-BR", store: AppStore) {
  return render(
    <TContext.Provider value={translator(language)}>
      <UsagePanel store={store} hostId="h" online costs />
    </TContext.Provider>,
  );
}

describe("estados-vazios: usage of a host", () => {
  for (const language of ["en", "pt-BR"] as const) {
    test(`a host with no usage says when the cost appears, instead of a table of headers, in ${language}`, async () => {
      const view = panel(language, fakeStore({ byDay: [] }));
      await uiIdle();
      expect(view.container.textContent).toContain(EMPTY[language]);
      expect(view.container.querySelector("table")).toBeNull();
    });
  }

  test("while the usage is loading, neither the empty text nor an empty table shows", async () => {
    const view = panel("en", fakeStore(null, true));
    await uiIdle();
    expect(view.container.textContent).not.toContain(EMPTY.en);
    expect(view.container.querySelector("table")).toBeNull();
  });

  test("a host with usage shows its table, not the empty text", async () => {
    const view = panel(
      "en",
      fakeStore({ byDay: [{ day: "2026-10-31", projectKey: "kA", costUsd: 1.5, tokens: 1200 }] }),
    );
    await uiIdle();
    expect(view.container.querySelector("table")?.textContent).toContain("kA");
    expect(view.container.textContent).not.toContain(EMPTY.en);
  });
});

const TEXT = {
  en: {
    loading: "Loading the usage…",
    failed: "Could not read the usage of this host.",
    retry: "Try again",
    offline: "This host is offline: the usage shows again when it is back.",
  },
  "pt-BR": {
    loading: "Carregando o uso…",
    failed: "Não foi possível ler o uso deste host.",
    retry: "Tentar de novo",
    offline: "Este host está offline: o uso aparece de novo quando ele voltar.",
  },
};

const ROWS = { byDay: [{ day: "2026-10-31", projectKey: "kA", costUsd: 1.5, tokens: 1200 }] };

/** A store whose answers come from `answers`, one per call, in order; `calls` counts the asks. */
function scriptedStore(answers: Array<unknown | Promise<unknown>>) {
  const calls: string[] = [];
  const store = {
    today: () => "2026-11-01",
    hostCommand: (host: string) => {
      calls.push(host);
      return Promise.resolve(answers[calls.length - 1]);
    },
  } as unknown as AppStore;
  return { store, calls };
}

function mount(
  language: "en" | "pt-BR",
  store: AppStore,
  props: { hostId?: string; online?: boolean } = {},
) {
  const element = (hostId: string, online: boolean) => (
    <TContext.Provider value={translator(language)}>
      <UsagePanel store={store} hostId={hostId} online={online} costs />
    </TContext.Provider>
  );
  const view = render(element(props.hostId ?? "h", props.online ?? true));
  return {
    view,
    show: (hostId: string, online = true) => view.rerender(element(hostId, online)),
  };
}

const status = (container: HTMLElement) => container.querySelector('[role="status"]');
const alert = (container: HTMLElement) => container.querySelector('[role="alert"]');

describe("usage of a host: loading, refused, stale and offline states (#4429)", () => {
  for (const language of ["en", "pt-BR"] as const) {
    test(`until the host answers, a loading status names what is loading, in ${language}`, async () => {
      const { store } = scriptedStore([new Promise(() => {})]);
      const { view } = mount(language, store);
      await uiIdle();
      expect(status(view.container)?.getAttribute("aria-label")).toBe(TEXT[language].loading);
    });

    test(`a refused read says so with Try again, not the empty text, in ${language}`, async () => {
      const { store } = scriptedStore([null]);
      const { view } = mount(language, store);
      await uiIdle();
      expect(alert(view.container)?.textContent ?? "").toContain(TEXT[language].failed);
      expect(alert(view.container)?.textContent ?? "").toContain(TEXT[language].retry);
      expect(view.container.textContent).not.toContain(EMPTY[language]);
    });

    test(`an offline host says it is offline and asks nothing, in ${language}`, async () => {
      const { store, calls } = scriptedStore([ROWS]);
      const { view } = mount(language, store, { online: false });
      await uiIdle();
      expect(view.container.textContent).toContain(TEXT[language].offline);
      expect(calls).toEqual([]);
    });
  }

  test("Try again asks the host again and shows what it answers", async () => {
    const { store, calls } = scriptedStore([null, ROWS]);
    const { view } = mount("en", store);
    await uiIdle();
    const retry = alert(view.container)?.querySelector("button") ?? null;
    expect(retry).not.toBeNull();
    await act(async () => {
      if (retry) fireEvent.click(retry);
    });
    await uiIdle();
    expect(calls).toEqual(["h", "h"]);
    expect(view.container.querySelector("table")?.textContent).toContain("kA");
    expect(alert(view.container)).toBeNull();
  });

  test("a read that answered with no rows still shows the empty text, not an error", async () => {
    const { store } = scriptedStore([{ byDay: [] }]);
    const { view } = mount("en", store);
    await uiIdle();
    expect(view.container.textContent).toContain(EMPTY.en);
    expect(alert(view.container)).toBeNull();
  });

  test("switching host drops the first host's rows until the second answers", async () => {
    const { store } = scriptedStore([ROWS, new Promise(() => {})]);
    const { view, show } = mount("en", store);
    await uiIdle();
    expect(view.container.querySelector("table")?.textContent).toContain("kA");
    show("other");
    await uiIdle();
    expect(view.container.querySelector("table")).toBeNull();
    expect(status(view.container)).not.toBeNull();
  });

  test("the first host's late answer does not replace the second host's rows", async () => {
    let late: (value: unknown) => void = () => {};
    const slow = new Promise((resolve) => {
      late = resolve;
    });
    const { store } = scriptedStore([slow, { byDay: [] }]);
    const { view, show } = mount("en", store);
    await uiIdle();
    show("other");
    await uiIdle();
    await act(async () => late(ROWS));
    await uiIdle();
    expect(view.container.querySelector("table")).toBeNull();
    expect(view.container.textContent).toContain(EMPTY.en);
  });
});
