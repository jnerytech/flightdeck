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
    backup: "Back up now",
    dry: "Simulate",
    clean: "Clean",
    sessions: "Sessions",
  },
  "pt-BR": {
    title: "Manutenção",
    failed: "Não foi possível ler os dados de manutenção deste host.",
    retry: "Tentar de novo",
    backup: "Fazer backup agora",
    dry: "Simular",
    clean: "Limpar",
    sessions: "Sessões",
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
    expect(screen.queryByRole("button", { name: w.retry }) !== null).toBe(true);
    // The panel has its own Try again: the toast offers none.
    expect(asked[0]).toEqual({ type: "maintenance.status", options: { retry: false } });
    refuse = false;
    await click(w.retry);
    await settle(() => screen.queryByText(w.sessions) !== null);
    expect(alertText()).toBe("");
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
    expect(asked.filter((a) => a.type === "maintenance.prune").length).toBe(1);
    await act(async () => {
      release({ events: 3 });
      await pending;
    });
    await settle(() => clean()?.getAttribute("aria-busy") !== "true");
  });
});
