import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, seedHosts } from "../fixtures.ts";
import { settle } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { VaultReport } = await import("../../src/features/vault/vault-report.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);

type Lang = "en" | "pt-BR";

const WORDS = {
  en: {
    failed: "Could not read the vault report. Check that the host is connected.",
    loading: "Loading the vault report",
    retry: "Try again",
    table: "Vault uses by secret",
    empty: "No use in this period",
    noDecisions: "No decision in this period",
    host: "Host",
  },
  "pt-BR": {
    failed: "Não deu para ler o relatório do cofre. Veja se o host está conectado.",
    loading: "Carregando o relatório do cofre",
    retry: "Tentar de novo",
    table: "Usos do cofre por segredo",
    empty: "Nenhum uso no período",
    noDecisions: "Nenhuma decisão no período",
    host: "Host",
  },
} as const;

const ROW = { secretId: "s1", requester: "claude", outcome: "allowed", count: 4 };
const DECISION = {
  id: "d1",
  secretId: "s1",
  requester: "claude",
  outcome: "allowed",
  reason: "rule matched",
  at: "2026-11-20T10:00:00.000Z",
};

type Asked = Array<{ host: string; type: string; options: unknown }>;
type Answer = (host: string, type: string, nth: number) => unknown;

/** The report on a store whose commands answer as `answer` says: a value, `null` for a refusal, or a promise. */
async function report(lang: Lang, answer: Answer, hostIds: string[] = ["h1"]) {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await store.i18n.setLang(lang);
  seedHosts(
    store,
    hostIds.map((id) => ({ id, name: `pc-${id}`, online: true, features: ["actions"] })),
  );
  const asked: Asked = [];
  store.hostCommand = (async (host: string, type: string, _payload: unknown, options?: unknown) => {
    asked.push({ host, type, options });
    return answer(host, type, asked.filter((a) => a.host === host && a.type === type).length);
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <VaultReport store={store} />
    </TContext.Provider>,
  );
  return { asked, store };
}

describe.each(["en", "pt-BR"] as const)("the vault Report tab, its states (%s)", (lang) => {
  const w = WORDS[lang];
  const click = (name: string) =>
    act(async () => {
      fireEvent.click(screen.queryByRole("button", { name }) as HTMLElement);
    });
  const hasButton = (name: string) => screen.queryByRole("button", { name }) !== null;
  const hasTable = () => screen.queryByRole("table", { name: w.table }) !== null;
  const answers: Answer = (_host, type) =>
    type === "vault.report" ? { rows: [ROW] } : { decisions: [DECISION] };

  test("while the host has not answered, a loading state shows and the empty texts do not", async () => {
    await report(lang, () => new Promise(() => {}));
    await act(async () => {});
    expect(screen.queryByRole("status", { name: w.loading }) !== null).toBe(true);
    expect(screen.queryByText(w.empty) === null).toBe(true);
    expect(screen.queryByText(w.noDecisions) === null).toBe(true);
  });

  test("a refused report is an alert with Try again, which reads it again", async () => {
    const { asked } = await report(lang, (host, type, nth) =>
      type === "vault.report" && nth === 1 ? null : answers(host, type, nth),
    );
    await act(async () => {});
    expect(screen.queryByRole("alert")?.textContent?.includes(w.failed)).toBe(true);
    expect(screen.queryByText(w.empty) === null).toBe(true);
    expect(screen.queryByText(w.noDecisions) === null).toBe(true);
    expect(hasButton(w.retry)).toBe(true);
    await click(w.retry);
    await settle(() => hasTable());
    expect(screen.queryByRole("alert") === null).toBe(true);
    // The tab has its own Try again, so no toast retry (it would drop the answer).
    expect(asked.every((a) => JSON.stringify(a.options ?? null) === '{"retry":false}')).toBe(true);
  });

  test("a refused decisions list is the same alert", async () => {
    await report(lang, (host, type, nth) =>
      type === "vault.decisions" && nth === 1 ? null : answers(host, type, nth),
    );
    await act(async () => {});
    expect(screen.queryByRole("alert")?.textContent?.includes(w.failed)).toBe(true);
    expect(screen.queryByText(w.noDecisions) === null).toBe(true);
    expect(hasButton(w.retry)).toBe(true);
    await click(w.retry);
    await settle(() => screen.queryByRole("alert") === null);
    expect(hasTable()).toBe(true);
  });

  test("picking another host clears the first host's table while the new one loads", async () => {
    await report(
      lang,
      (host, type, nth) => (host === "h2" ? new Promise(() => {}) : answers(host, type, nth)),
      ["h1", "h2"],
    );
    await settle(() => hasTable());
    const select = screen.queryByRole("combobox", { name: w.host }) as HTMLSelectElement;
    expect(select !== null).toBe(true);
    await act(async () => {
      fireEvent.change(select, { target: { value: "h2" } });
    });
    expect(hasTable()).toBe(false);
    expect(screen.queryByText(w.empty) === null).toBe(true);
  });

  test("a late answer of the first host never shows once another host is picked", async () => {
    let late: (value: unknown) => void = () => {};
    await report(
      lang,
      (host, type, nth) => {
        if (host === "h1" && nth === 1) return new Promise((resolve) => void (late = resolve));
        if (host === "h1") return answers(host, type, nth);
        return new Promise(() => {});
      },
      ["h1", "h2"],
    );
    const select = screen.queryByRole("combobox", { name: w.host }) as HTMLSelectElement;
    expect(select !== null).toBe(true);
    await act(async () => {
      fireEvent.change(select, { target: { value: "h2" } });
    });
    await act(async () => {
      late({ rows: [ROW], decisions: [DECISION] });
    });
    expect(hasTable()).toBe(false);
    expect(screen.queryByRole("status", { name: w.loading }) !== null).toBe(true);
  });
});
