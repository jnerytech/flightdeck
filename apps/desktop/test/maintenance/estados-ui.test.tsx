import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settle, stays } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { MaintenanceSection } = await import("../../src/features/maintenance/ui.ts");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);

type Lang = "en" | "pt-BR";

const WORDS = {
  en: {
    title: "Maintenance",
    failed: "Could not read this host's maintenance data.",
    retry: "Try again",
    backup: "Back up this host's database",
    dry: "Simulate",
    clean: "Clean up old data",
    sessions: "Sessions",
    db: "Database",
    events: "Events",
    lastBackup: "Last backup",
    lastCleanup: "Last cleanup",
    unrecorded: "not recorded",
    backupDone: "Backup created at /data/backup-1.db on this host.",
    simulated: "Simulation: a cleanup would delete these rows: events 5. Nothing was deleted.",
    cleaned: "Cleanup done. Rows deleted: events 5.",
    point: ".",
    thousands: "12,345",
  },
  "pt-BR": {
    title: "Manutenção",
    failed: "Não foi possível ler os dados de manutenção deste host.",
    retry: "Tentar de novo",
    backup: "Fazer backup do banco deste host",
    dry: "Simular",
    clean: "Limpar dados antigos",
    sessions: "Sessões",
    db: "Banco",
    events: "Eventos",
    lastBackup: "Último backup",
    lastCleanup: "Última limpeza",
    unrecorded: "não registrada",
    backupDone: "Backup criado em /data/backup-1.db neste host.",
    simulated: "Simulação: uma limpeza apagaria estas linhas: eventos 5. Nada foi apagado.",
    cleaned: "Limpeza concluída. Linhas apagadas: eventos 5.",
    point: ",",
    thousands: "12.345",
  },
} as const;

const STATUS = {
  dbBytes: 2048,
  lastBackup: null,
  backups: [],
  lastPrune: null,
  counts: { sessions: 7, events: 30, externalSessions: 2 },
};

/** The command types asked, in order, with the options of each. */
type Asked = Array<{ type: string; options: unknown }>;

/**
 * The section on a store whose commands answer as `answer` says: a value, `null` for a refusal,
 * or a promise the test settles later.
 */
async function section(lang: Lang, answer: (type: string, asked: Asked) => unknown) {
  const store = new AppStore(memoryPlatform(false, lang).platform, { baseDelayMs: 600_000 });
  await store.i18n.setLang(lang);
  const asked: Asked = [];
  store.hostCommand = (async (
    _host: string,
    type: string,
    _payload: unknown,
    options?: unknown,
  ) => {
    asked.push({ type, options });
    return answer(type, asked);
  }) as never;
  render(
    <TContext.Provider value={store.i18n.t}>
      <MaintenanceSection store={store} hostId="h1" />
    </TContext.Provider>,
  );
  // The first command asked, then what resolves at once has landed: the red reads the screen.
  await settle(() => asked.length > 0);
  await act(async () => {});
  return { asked, store };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

/** What the panel says next to a label: the description that follows its term. */
const fact = (label: string) =>
  [...document.querySelectorAll("dt")].find((dt) => dt.textContent === label)?.nextElementSibling
    ?.textContent;
const outcome = () => screen.queryByRole("status")?.textContent ?? "";
/** Clean's confirmation, answered with the same button label. */
async function confirmClean(name: string) {
  const dialog = screen.queryByRole("alertdialog");
  expect(dialog).not.toBeNull();
  const confirm = within(dialog as HTMLElement).queryByRole("button", { name });
  expect(confirm).not.toBeNull();
  await act(async () => {
    fireEvent.click(confirm as HTMLElement);
  });
}
const alertText = () =>
  screen
    .queryAllByRole("alert")
    .map((el) => el.textContent ?? "")
    .join(" ");

describe.each(["en", "pt-BR"] as const)("the Maintenance panel (%s)", (lang) => {
  const w = WORDS[lang];

  test("a refused status shows an error with Try again, and Try again shows the facts", async () => {
    let refuse = true;
    const { asked } = await section(lang, (type) =>
      type === "maintenance.status" ? (refuse ? null : STATUS) : null,
    );
    expect(alertText().includes(w.failed)).toBe(true);
    expect(screen.queryByRole("button", { name: w.retry })).not.toBeNull();
    // The panel has its own Try again: the toast offers none.
    expect(asked[0]).toEqual({ type: "maintenance.status", options: { retry: false } });
    refuse = false;
    await click(w.retry);
    await settle(() => screen.queryByText(w.sessions) !== null);
    expect(alertText()).toBe("");
  });

  test("the outcome line is an output element that is empty and out of the way until a result arrives", async () => {
    await section(lang, (type) => (type === "maintenance.status" ? STATUS : null));
    await settle(() => screen.queryByText(w.sessions) !== null);
    const line = screen.queryByRole("status");
    expect({
      tag: line?.tagName,
      empty: line?.textContent,
      collapses: line?.className.includes("empty:sr-only"),
    }).toEqual({ tag: "OUTPUT", empty: "", collapses: true });
  });

  test("the result of a backup is announced as a status", async () => {
    const { asked } = await section(lang, (type) =>
      type === "maintenance.status" ? STATUS : { path: "/data/backup-1.db" },
    );
    await click(w.backup);
    // The facts are on screen: a failed refresh after the action keeps the toast's retry.
    const loads = asked.filter((a) => a.type === "maintenance.status");
    expect(loads.map((a) => a.options)).toEqual([{ retry: false }, { retry: true }]);
    await settle(() => screen.queryByText(/backup-1\.db/) !== null);
    expect(screen.queryByRole("status")?.textContent?.includes("/data/backup-1.db")).toBe(true);
  });

  test("a refused backup does not leave the last outcome on screen as if it were current", async () => {
    let refuse = false;
    await section(lang, (type) =>
      type === "maintenance.status" ? STATUS : refuse ? null : { path: "/data/backup-1.db" },
    );
    await click(w.backup);
    await settle(() => screen.queryByText(/backup-1\.db/) !== null);
    refuse = true;
    await click(w.backup);
    await act(async () => {});
    expect(screen.queryByText(/backup-1\.db/)).toBeNull();
  });

  test("the sizes and counts follow the language: a decimal mark, a unit up to GB and a thousands separator", async () => {
    await section(lang, (type) =>
      type === "maintenance.status"
        ? {
            ...STATUS,
            dbBytes: 1.5 * 1024 ** 3,
            lastBackup: { path: "/b.db", at: "2026-11-10T12:00:00Z", bytes: 709_120 },
            counts: { sessions: 7, events: 12_345, externalSessions: 2 },
          }
        : null,
    );
    await settle(() => screen.queryByText(w.sessions) !== null);
    expect(fact(w.db)).toBe(`1${w.point}5 GB`);
    expect(fact(w.lastBackup)?.endsWith(`(692${w.point}5 KB)`)).toBe(true);
    expect(fact(w.events)).toBe(w.thousands);
  });

  test("a simulation never replaces the date of the last real cleanup", async () => {
    const real = "2026-11-10T09:00:00Z";
    const simulated = "2026-11-20T09:00:00Z";
    let simulating = false;
    const { store } = await section(lang, (type) =>
      type === "maintenance.status"
        ? {
            ...STATUS,
            lastPrune: simulating
              ? { at: simulated, dryRun: true, counts: { events: 5 } }
              : { at: real, dryRun: false, counts: { events: 9 } },
          }
        : { events: 5 },
    );
    await settle(() => screen.queryByText(w.sessions) !== null);
    expect(fact(w.lastCleanup)).toBe(store.formatDateTime(real));
    simulating = true;
    await click(w.dry);
    await settle(() => outcome() !== "");
    expect(fact(w.lastCleanup)).toBe(store.formatDateTime(real));
  });

  test("a host that only recorded a simulation says its last cleanup is not recorded", async () => {
    const simulated = "2026-11-20T09:00:00Z";
    await section(lang, (type) =>
      type === "maintenance.status"
        ? { ...STATUS, lastPrune: { at: simulated, dryRun: true, counts: { events: 5 } } }
        : null,
    );
    await settle(() => screen.queryByText(w.sessions) !== null);
    expect(fact(w.lastCleanup)).toBe(w.unrecorded);
  });

  test("the three outcomes are sentences", async () => {
    await section(lang, (type) => {
      if (type === "maintenance.status") return STATUS;
      return type === "maintenance.backup" ? { path: "/data/backup-1.db" } : { events: 5 };
    });
    await click(w.backup);
    await settle(() => outcome() === w.backupDone);
    await click(w.dry);
    await settle(() => outcome() === w.simulated);
    await click(w.clean);
    await confirmClean(w.clean);
    await settle(() => outcome() === w.cleaned);
    expect(outcome()).toBe(w.cleaned);
  });

  test("the three buttons sit in one row that wraps when the panel is narrow", async () => {
    await section(lang, (type) => (type === "maintenance.status" ? STATUS : null));
    const row = screen.queryByRole("button", { name: w.backup })?.parentElement;
    expect(row?.className.includes("flex-wrap")).toBe(true);
    expect(row?.querySelectorAll("button").length).toBe(3);
  });

  test("Clean is busy while the prune runs, and a second click starts no second prune", async () => {
    let release: (counts: Record<string, number>) => void = () => {};
    const pending = new Promise<Record<string, number>>((resolve) => {
      release = resolve;
    });
    const { asked } = await section(lang, (type) =>
      type === "maintenance.status" ? STATUS : pending,
    );
    await click(w.clean);
    const dialog = screen.queryByRole("alertdialog");
    expect(dialog).not.toBeNull();
    const confirm = within(dialog as HTMLElement).queryByRole("button", { name: w.clean });
    expect(confirm).not.toBeNull();
    await act(async () => {
      fireEvent.click(confirm as HTMLElement);
    });
    await settle(() => asked.some((a) => a.type === "maintenance.prune"));
    const clean = () => screen.queryByRole("button", { name: w.clean });
    expect(clean()?.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      fireEvent.click(clean() as HTMLElement);
    });
    // A busy Clean opens no second confirmation.
    await stays(() => screen.queryByRole("alertdialog") === null, 300);
    expect(asked.filter((a) => a.type === "maintenance.prune")).toHaveLength(1);
    await act(async () => {
      release({ events: 3 });
      await pending;
    });
    await settle(() => clean()?.getAttribute("aria-busy") !== "true");
  });
});
