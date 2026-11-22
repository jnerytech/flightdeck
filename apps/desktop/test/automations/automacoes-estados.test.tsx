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

/** Issue #4189: the states of the Automations page: a partial load, a request in flight, a long history. */
const WORDS = {
  en: {
    listFailed: "Could not read the automations. Check that the host is connected.",
    workflowsFailed: "Could not read the workflows. Check that the host is connected.",
    retry: "Try again",
    history: (n: string) => `History of ${n}`,
    remove: (n: string) => `Delete ${n}`,
    confirmRemove: "Delete",
    runs: (n: string) => `Firings of ${n}`,
    row: (n: string) => `Automation ${n}`,
  },
  "pt-BR": {
    listFailed: "Não deu para ler as automações. Veja se o host está conectado.",
    workflowsFailed: "Não deu para ler os workflows. Veja se o host está conectado.",
    retry: "Tentar de novo",
    history: (n: string) => `Histórico de ${n}`,
    remove: (n: string) => `Excluir ${n}`,
    confirmRemove: "Excluir",
    runs: (n: string) => `Disparos de ${n}`,
    row: (n: string) => `Automação ${n}`,
  },
} as const;

const AUTOMATION = {
  id: "a1",
  projectId: "p1",
  name: "nightly",
  enabled: true,
  trigger: { type: "cron", expr: "0 9 * * 1-5", tz: "UTC" },
  action: { type: "start_workflow", workflow: "feature" },
  maxRunsPerDay: 10,
  allowExternalAuthors: false,
  createdAt: "2026-11-21T10:00:00.000Z",
};
const SECOND = { ...AUTOMATION, id: "a2", name: "weekly" };

/** An answer that arrives when `release` is called: a request still in flight until then. */
function pending<T>() {
  let release: (value: T) => void = () => {};
  const answer = new Promise<T>((resolve) => {
    release = resolve;
  });
  return { answer, release };
}

type Answer = (type: string, nth: number, payload: Record<string, unknown>) => unknown;

/** The page on a store whose commands answer as `answer` says: a value, a promise, or `null` for a refusal. */
async function page(lang: Lang, answer: Answer) {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await store.i18n.setLang(lang);
  seedHosts(store, [{ id: "h1", name: "pc", online: true, features: ["automations"] }]);
  const asked: Array<{ type: string; payload: Record<string, unknown> }> = [];
  store.hostCommand = (async (_host: string, type: string, payload: Record<string, unknown>) => {
    asked.push({ type, payload });
    return answer(type, asked.filter((a) => a.type === type).length, payload);
  }) as never;
  render(<AutomationsPage store={store} hostId="h1" projectId="p1" projectName="app" />);
  await act(async () => {});
  const count = (type: string) => asked.filter((a) => a.type === type).length;
  return { asked, count };
}

describe.each(["en", "pt-BR"] as const)("the Automations page, its states (%s)", (lang) => {
  const w = WORDS[lang];
  const press = (name: string) =>
    act(async () => {
      fireEvent.click(screen.queryByRole("button", { name }) as HTMLElement);
    });
  const flip = () =>
    act(async () => {
      fireEvent.click(screen.queryByRole("switch", { name: w.row("nightly") }) as HTMLElement);
    });
  const alertText = () => screen.queryByRole("alert")?.textContent ?? "";
  const lists = (type: string) =>
    type === "automation.list" ? { automations: [AUTOMATION, SECOND] } : { workflows: [] };

  test("only the workflow list failing says the workflows could not be read, and the automations stay", async () => {
    await page(lang, (type) => (type === "automation.list" ? { automations: [AUTOMATION] } : null));
    await settle(() => screen.queryByRole("listitem", { name: w.row("nightly") }) !== null);
    expect({
      said: alertText().includes(w.workflowsFailed),
      notTheList: alertText().includes(w.listFailed),
      row: screen.queryByRole("listitem", { name: w.row("nightly") }) !== null,
      retry: screen.queryByRole("button", { name: w.retry }) !== null,
    }).toEqual({ said: true, notTheList: false, row: true, retry: true });
  });

  test("both lists failing says the automations could not be read, once", async () => {
    await page(lang, () => null);
    expect({
      said: alertText().includes(w.listFailed),
      notTheWorkflows: alertText().includes(w.workflowsFailed),
      alerts: screen.queryAllByRole("alert").length,
    }).toEqual({ said: true, notTheWorkflows: false, alerts: 1 });
  });

  test("a second press on the switch while its answer is not in sends no second request", async () => {
    const gate = pending<unknown>();
    const { count } = await page(lang, (type) =>
      type === "automation.toggle" ? gate.answer : lists(type),
    );
    await settle(() => screen.queryByRole("switch", { name: w.row("nightly") }) !== null);
    await flip();
    await flip();
    const during = count("automation.toggle");
    await act(async () => {
      gate.release({ ...AUTOMATION, enabled: false });
    });
    await flip();
    expect({ during, after: count("automation.toggle") }).toEqual({ during: 1, after: 2 });
  });

  test("a second press on History while its answer is not in sends no second request", async () => {
    const gate = pending<unknown>();
    const { count } = await page(lang, (type) =>
      type === "automation.runs" ? gate.answer : lists(type),
    );
    await settle(() => screen.queryByRole("button", { name: w.history("nightly") }) !== null);
    await press(w.history("nightly"));
    await press(w.history("nightly"));
    expect(count("automation.runs")).toBe(1);
    await act(async () => {
      gate.release({ runs: [] });
    });
  });

  test("two histories asked at once both show when answered", async () => {
    const first = pending<unknown>();
    const second = pending<unknown>();
    await page(lang, (type, _nth, payload) => {
      if (type !== "automation.runs") return lists(type);
      return payload.id === "a1" ? first.answer : second.answer;
    });
    await settle(() => screen.queryByRole("button", { name: w.history("weekly") }) !== null);
    await press(w.history("nightly"));
    await press(w.history("weekly"));
    await act(async () => {
      first.release({ runs: [] });
      second.release({ runs: [] });
    });
    await settle(() => screen.queryAllByRole("button", { expanded: true }).length > 0);
    expect(screen.queryAllByRole("button", { expanded: true }).length).toBe(2);
  });

  test("Delete is not offered again for a row whose removal is in flight", async () => {
    const gate = pending<unknown>();
    const { count } = await page(lang, (type) =>
      type === "automation.remove" ? gate.answer : lists(type),
    );
    await settle(() => screen.queryByRole("button", { name: w.remove("nightly") }) !== null);
    await press(w.remove("nightly"));
    await press(w.confirmRemove);
    const row = screen.queryByRole("button", { name: w.remove("nightly") }) as HTMLButtonElement;
    expect({ asked: count("automation.remove"), disabled: row?.disabled }).toEqual({
      asked: 1,
      disabled: true,
    });
    await act(async () => {
      gate.release({ automations: [SECOND] });
    });
  });

  test("an open history is a list with its own height limit and a way to scroll it by keyboard, its name unchanged", async () => {
    const runs = Array.from({ length: 100 }, (_, i) => ({
      id: `r${i}`,
      automationId: "a1",
      firedAt: "2026-11-21T10:00:00.000Z",
      cause: "cron",
      status: "ok",
      detail: null,
    }));
    await page(lang, (type) => (type === "automation.runs" ? { runs } : lists(type)));
    await settle(() => screen.queryByRole("button", { name: w.history("nightly") }) !== null);
    await press(w.history("nightly"));
    await settle(() => screen.queryByRole("list", { name: w.runs("nightly") }) !== null);
    const list = screen.queryByRole("list", { name: w.runs("nightly") });
    expect({
      scrolls: list?.classList.contains("overflow-y-auto"),
      capped: [...(list?.classList ?? [])].some((c) => c.startsWith("max-h-")),
      focusable: list?.getAttribute("tabindex"),
    }).toEqual({ scrolls: true, capped: true, focusable: "0" });
  });
});
