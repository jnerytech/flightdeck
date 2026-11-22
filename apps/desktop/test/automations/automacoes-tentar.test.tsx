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

/** Issue #3856: each row's buttons name their automation, and History says whether its list is open. */
const BUTTONS = {
  en: {
    edit: (n: string) => `Edit ${n}`,
    remove: (n: string) => `Delete ${n}`,
    history: (n: string) => `History of ${n}`,
    hide: (n: string) => `Hide history of ${n}`,
  },
  "pt-BR": {
    edit: (n: string) => `Editar ${n}`,
    remove: (n: string) => `Excluir ${n}`,
    history: (n: string) => `Histórico de ${n}`,
    hide: (n: string) => `Esconder histórico de ${n}`,
  },
} as const;

describe.each(["en", "pt-BR"] as const)("the Automations rows, their buttons (%s)", (lang) => {
  const b = BUTTONS[lang];
  const second = { ...AUTOMATION, id: "a2", name: "weekly" };
  const names = () =>
    screen.queryAllByRole("button").map((button) => button.getAttribute("aria-label") ?? "");

  test("Edit, History and Delete name the automation they act on, one set per row", async () => {
    await page(lang, (type) =>
      type === "automation.list" ? { automations: [AUTOMATION, second] } : { workflows: [] },
    );
    await settle(() => screen.queryByRole("listitem", { name: WORDS[lang].row }) !== null);
    const found = ["nightly", "weekly"].flatMap((n) => [b.edit(n), b.history(n), b.remove(n)]);
    expect(found.every((name) => screen.queryByRole("button", { name }) !== null)).toBe(true);
    expect(new Set(names().filter((name) => name !== "")).size).toBe(
      names().filter(Boolean).length,
    );
  });

  test("History is expanded while its firings show, and collapsed after", async () => {
    await page(lang, (type) => {
      if (type === "automation.list") return { automations: [AUTOMATION, second] };
      return type === "automation.runs" ? { runs: [] } : { workflows: [] };
    });
    const state = (name: string) =>
      screen.queryByRole("button", { name })?.getAttribute("aria-expanded");
    expect(state(b.history("nightly"))).toBe("false");
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: b.history("nightly") }) as HTMLElement);
    });
    await settle(() => screen.queryByRole("button", { name: b.hide("nightly") }) !== null);
    expect(state(b.hide("nightly"))).toBe("true");
    expect(state(b.history("weekly"))).toBe("false");
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: b.hide("nightly") }) as HTMLElement);
    });
    expect(state(b.history("nightly"))).toBe("false");
  });
});
