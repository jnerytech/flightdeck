import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { BackupSchedulePanel } = await import("../../src/features/backup/backup-schedule-panel.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/** Issue #4347: the Last backup and Next backup lines are status regions, so a change is announced. */
describe.each([
  {
    lang: "en",
    folder: "Choose folder",
    cadence: "Every day",
    never: "No scheduled backup yet.",
    next: "Next backup: waiting for the passphrase.",
  },
  {
    lang: "pt-BR",
    folder: "Escolher pasta",
    cadence: "Todo dia",
    never: "Ainda não houve backup agendado.",
    next: "Próximo backup: aguardando a frase-senha.",
  },
] as const)("backup-schedule-ui: the run lines are announced ($lang)", (w) => {
  test("the last-run and next-run lines sit in status regions", async () => {
    const { platform } = memoryPlatform(false, w.lang);
    platform.backupFolder = {
      pick: async () => "/backups",
      current: async () => "/backups",
      write: async () => {},
      list: async () => [],
      remove: async () => {},
    };
    const store = new AppStore(platform, { baseDelayMs: 600_000, vaultWorkFactor: 4 });
    store.i18n.start();
    render(
      <TContext.Provider value={store.i18n.t}>
        <BackupSchedulePanel store={store} />
      </TContext.Provider>,
    );
    const press = async (name: string) => {
      const control = screen.queryByRole("button", { name }) ?? screen.queryByLabelText(name);
      expect(control).not.toBeNull();
      await act(async () => fireEvent.click(control as HTMLElement));
    };
    await press(w.folder);
    await press(w.cadence);
    const inStatus = (text: string) =>
      screen.queryAllByRole("status").some((box) => (box.textContent ?? "") === text);
    expect({ last: inStatus(w.never), next: inStatus(w.next) }).toEqual({ last: true, next: true });
  });
});
