import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { AgentContext } = await import("../../src/features/agentcfg/agent-context.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);

type Lang = "en" | "pt-BR";

/** Issue #4079: a refused `memory.budget` says so and offers a retry, instead of loading for ever. */
const WORDS = {
  en: {
    loading: "Loading the configuration…",
    failed: "Could not load this project's configuration.",
    retry: "Try again",
    title: "Context budget",
  },
  "pt-BR": {
    loading: "Carregando a configuração…",
    failed: "Não foi possível carregar a configuração deste projeto.",
    retry: "Tentar de novo",
    title: "Orçamento de contexto",
  },
} as const;

const BUDGET = {
  sources: [],
  startTokens: 7,
  memory: {
    limitLines: 200,
    limitBytes: 25_600,
    indexLines: 0,
    indexBytes: 0,
    loadedLines: 0,
    loadedBytes: 0,
    cutBy: null,
    leftOutLines: [],
    leftOutFiles: [],
  },
};

/** The Context tab of a host that refuses `memory.budget` until `heal()` is called. */
async function mount(lang: Lang) {
  const s = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await s.i18n.setLang(lang);
  let healthy = false;
  s.hostCommand = (async () => (healthy ? BUDGET : null)) as never;
  render(
    <TContext.Provider value={s.i18n.t}>
      <AgentContext store={s} hostId="h1" projectId="p1" />
    </TContext.Provider>,
  );
  return { w: WORDS[lang], heal: () => (healthy = true) };
}

describe.each(["en", "pt-BR"] as const)("the Context tab, a refused budget (%s)", (lang) => {
  test("the failure shows its words and a retry, not the loading text for ever", async () => {
    const { w } = await mount(lang);
    await act(async () => {});
    expect(screen.queryByText(w.failed)).not.toBeNull();
    expect(screen.queryByRole("button", { name: w.retry })).not.toBeNull();
    expect(screen.queryByText(w.loading)).toBeNull();
  });

  test("Try again asks the host once more, and the budget shows when it answers", async () => {
    const { w, heal } = await mount(lang);
    await act(async () => {});
    expect(screen.queryByRole("button", { name: w.retry })).not.toBeNull();
    heal();
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: w.retry }) as HTMLElement);
    });
    expect(screen.queryByRole("region", { name: w.title })).not.toBeNull();
    expect(screen.queryByText(w.failed)).toBeNull();
  });
});
