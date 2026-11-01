import { afterEach, describe, expect, test } from "bun:test";
import { registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, render } = await import("@testing-library/react");
const { TContext } = await import("../src/i18n/context.tsx");
const { translator } = await import("../src/i18n/index.ts");
const { UsagePanel } = await import("../src/ui/UsagePanel.tsx");

import type { AppStore } from "../src/lib/app-store.ts";

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
      await act(() => Bun.sleep(10));
      expect(view.container.textContent).toContain(EMPTY[language]);
      expect(view.container.querySelector("table")).toBeNull();
    });
  }

  test("while the usage is loading, neither the empty text nor an empty table shows", async () => {
    const view = panel("en", fakeStore(null, true));
    await act(() => Bun.sleep(10));
    expect(view.container.textContent).not.toContain(EMPTY.en);
    expect(view.container.querySelector("table")).toBeNull();
  });

  test("a host with usage shows its table, not the empty text", async () => {
    const view = panel(
      "en",
      fakeStore({ byDay: [{ day: "2026-10-31", projectKey: "kA", costUsd: 1.5, tokens: 1200 }] }),
    );
    await act(() => Bun.sleep(10));
    expect(view.container.querySelector("table")?.textContent).toContain("kA");
    expect(view.container.textContent).not.toContain(EMPTY.en);
  });
});
