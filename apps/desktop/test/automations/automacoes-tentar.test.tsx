import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, seedHosts } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { AutomationsPage } = await import("../../src/features/automations/page.tsx");

afterEach(cleanup);

type Lang = "en" | "pt-BR";

/** Issue #3855: a refused load of the Automations page is an alert with Try again, not a spinner for ever. */
const WORDS = {
  en: {
    failed: "Could not read the automations. Check that the host is connected.",
    retry: "Try again",
    empty: "No automations in this project",
    row: "Automation nightly",
  },
  "pt-BR": {
    failed: "Não deu para ler as automações. Veja se o host está conectado.",
    retry: "Tentar de novo",
    empty: "Nenhuma automação neste projeto",
    row: "Automação nightly",
  },
} as const;

const AUTOMATION = {
  id: "a1",
  projectId: "p1",
  name: "nightly",
  enabled: false,
  trigger: { type: "cron", expr: "0 9 * * 1-5", tz: "UTC" },
  action: { type: "start_workflow", workflow: "feature" },
  maxRunsPerDay: 10,
  allowExternalAuthors: false,
  createdAt: "2026-11-21T10:00:00.000Z",
};

type Asked = Array<{ type: string; options: unknown }>;

/** The page on a store whose commands answer as `answer` says: a value, or `null` for a refusal. */
async function page(lang: Lang, answer: (type: string, nth: number) => unknown) {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await store.i18n.setLang(lang);
  seedHosts(store, [{ id: "h1", name: "pc", online: true, features: ["automations"] }]);
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
  render(<AutomationsPage store={store} hostId="h1" projectId="p1" projectName="app" />);
  await act(async () => {});
  return { asked };
}

describe.each(["en", "pt-BR"] as const)("the Automations page, a refused load (%s)", (lang) => {
  const w = WORDS[lang];
  const click = (name: string) =>
    act(async () => {
      fireEvent.click(screen.queryByRole("button", { name }) as HTMLElement);
    });

  test("a refused list is an alert with Try again, which loads the list", async () => {
    const { asked } = await page(lang, (type, nth) => {
      if (type === "automation.list") return nth === 1 ? null : { automations: [AUTOMATION] };
      return { workflows: [] };
    });
    expect(screen.queryByRole("alert")?.textContent?.includes(w.failed)).toBe(true);
    expect(screen.queryByText(w.empty)).toBeNull();
    expect(screen.queryByRole("button", { name: w.retry }) !== null).toBe(true);
    await click(w.retry);
    await settle(() => screen.queryByRole("listitem", { name: w.row }) !== null);
    expect(screen.queryByRole("alert")).toBeNull();
    // The page has its own Try again, so no toast retry (it would drop the answer).
    const loads = asked.filter((a) => a.type === "automation.list");
    expect(loads.every((a) => JSON.stringify(a.options) === '{"retry":false}')).toBe(true);
  });

  test("a refused workflow list is an alert too, and the automations stay", async () => {
    await page(lang, (type) => (type === "automation.list" ? { automations: [AUTOMATION] } : null));
    await settle(() => screen.queryByRole("listitem", { name: w.row }) !== null);
    expect(screen.queryByRole("alert")?.textContent?.includes(w.failed)).toBe(true);
    expect(screen.queryByRole("listitem", { name: w.row }) !== null).toBe(true);
  });
});
