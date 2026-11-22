import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, seedHosts } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { WorkflowsPage } = await import("../../src/features/workflows/page.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);

type Lang = "en" | "pt-BR";

const WORDS = {
  en: {
    failed: "Could not read the workflows. Check that the host is connected.",
    templatesFailed:
      "Could not load the templates. The host may be offline or need a newer version of Flightdeck.",
    retry: "Try again",
    empty: "No workflows on the base branch yet.",
    item: "Workflow feature",
    trust: "Trust feature",
    confirm: "Trust",
    open: "Add from a template",
    template: "Alert fixer",
  },
  "pt-BR": {
    failed: "Não deu para ler os workflows. Veja se o host está conectado.",
    templatesFailed:
      "Não deu para carregar os modelos. O host pode estar offline ou precisar de uma versão mais nova do Flightdeck.",
    retry: "Tentar de novo",
    empty: "Nenhum workflow na branch base ainda.",
    item: "Workflow feature",
    trust: "Confiar em feature",
    confirm: "Confiar",
    open: "Adicionar de um modelo",
    template: "Corretor de alertas",
  },
} as const;

const WORKFLOW = { name: "feature", hash: "h", trusted: false, checks: ["bun test"], errors: [] };
const TEMPLATE = {
  id: "alert-fixer",
  title: { en: "Alert fixer", "pt-BR": "Corretor de alertas" },
  description: { en: "Fixes one alert.", "pt-BR": "Corrige um alerta." },
  limits: { en: "Tries 3 times.", "pt-BR": "Tenta 3 vezes." },
  persona: "dev",
  inputs: ["alert"],
  path: ".flightdeck/workflows/alert-fixer.yaml",
  yaml: "name: Alert fixer\n",
  checkFilled: true,
};

type Asked = Array<{ type: string; options: unknown }>;

/** The page on a store whose commands answer as `answer` says: a value, or `null` for a refusal. */
async function page(lang: Lang, answer: (type: string, nth: number) => unknown) {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await store.i18n.setLang(lang);
  seedHosts(store, [{ id: "h1", name: "pc", online: true, features: ["workflows"] }]);
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
      <WorkflowsPage store={store} hostId="h1" projectId="p1" projectName="app" />
    </TContext.Provider>,
  );
  await act(async () => {});
  return { asked, store };
}

describe.each(["en", "pt-BR"] as const)("the Workflows page, a refused load (%s)", (lang) => {
  const w = WORDS[lang];
  const click = (name: string) =>
    act(async () => {
      fireEvent.click(screen.queryByRole("button", { name }) as HTMLElement);
    });
  const hasButton = (name: string) => screen.queryByRole("button", { name }) !== null;

  test("a refused list is an alert with Try again, which loads the list", async () => {
    await page(lang, (type, nth) => {
      if (type === "workflow.list") return nth === 1 ? null : { workflows: [WORKFLOW] };
      return null;
    });
    expect(screen.queryByRole("alert")?.textContent?.includes(w.failed)).toBe(true);
    expect(screen.queryByText(w.empty)).toBeNull();
    expect(hasButton(w.retry)).toBe(true);
    await click(w.retry);
    await settle(() => screen.queryByRole("listitem", { name: w.item }) !== null);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a refused refresh after Trust keeps the list, shows the alert and Try again reloads it", async () => {
    const { asked } = await page(lang, (type, nth) => {
      if (type === "workflow.list") return nth === 2 ? null : { workflows: [WORKFLOW] };
      return {};
    });
    await settle(() => screen.queryByRole("listitem", { name: w.item }) !== null);
    await click(w.trust);
    await click(w.confirm);
    await act(async () => {});
    expect(screen.queryByRole("alert")?.textContent?.includes(w.failed)).toBe(true);
    expect(screen.queryByRole("listitem", { name: w.item })).not.toBeNull();
    expect(hasButton(w.retry)).toBe(true);
    await click(w.retry);
    await settle(() => screen.queryByRole("alert") === null);
    expect(screen.queryByRole("listitem", { name: w.item })).not.toBeNull();
    // The page has its own Try again, so no toast retry (it would drop the answer).
    const loads = asked.filter((a) => a.type === "workflow.list");
    expect(loads.every((a) => JSON.stringify(a.options) === '{"retry":false}')).toBe(true);
  });

  test("a refused template list is an alert with Try again, which loads the templates", async () => {
    await page(lang, (type, nth) => {
      if (type === "workflow.list") return { workflows: [] };
      if (type === "workflow.templates") return nth === 1 ? null : { templates: [TEMPLATE] };
      return null;
    });
    await click(w.open);
    await act(async () => {});
    expect(screen.queryByText(w.templatesFailed)).not.toBeNull();
    expect(hasButton(w.retry)).toBe(true);
    await click(w.retry);
    await settle(() => screen.queryByText(w.template) !== null);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
