import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { SCHEDULE_KEY } from "../../src/features/backup/backup-schedule.ts";
import { registerDom } from "../dom.ts";
import { memoryPlatform, waitFor } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { BackupSchedulePanel } = await import("../../src/features/backup/backup-schedule-panel.tsx");

setDefaultTimeout(30_000);
/**
 * Issues #2654 and #2655: the passphrase form of Settings > Backup schedule appears and leaves with a
 * focus move and an announcement, and a folder path with no spaces wraps instead of widening the card.
 */
afterEach(cleanup);

const PASS = "correct horse battery";
const LONG_FOLDER = `C:\\${"Backups\\".repeat(15)}flightdeck`;

function open(options: { due?: boolean; folder?: string } = {}) {
  const { platform } = memoryPlatform(false, "en");
  if (options.due) {
    platform.storage.setItem(
      SCHEDULE_KEY,
      JSON.stringify({ cadence: "daily", target: "folder", keep: 5, lastRunAt: null }),
    );
  }
  const folder = options.folder ?? "/backups";
  platform.backupFolder = {
    pick: async () => folder,
    current: async () => folder,
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
  return { store };
}

const radio = (name: string) => screen.queryByRole("radio", { name }) as HTMLInputElement;
const passphraseField = () =>
  screen.queryByLabelText("Passphrase for this session") as HTMLInputElement | null;
async function choose(name: string) {
  // A click on a radio focuses it first, which fireEvent alone does not do.
  radio(name).focus();
  await act(async () => fireEvent.click(radio(name)));
}
async function type(value: string) {
  const input = passphraseField();
  if (input) await act(async () => fireEvent.change(input, { target: { value } }));
}
const press = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  if (button) await act(async () => fireEvent.click(button));
};

describe("backup-schedule-focus-ui: the passphrase form moves the focus and announces (#2654)", () => {
  test("picking Every day with no passphrase puts the focus in the passphrase field", async () => {
    open();
    await press("Choose folder");
    await choose("Every day");
    expect([passphraseField() !== null, document.activeElement === passphraseField()]).toEqual([
      true,
      true,
    ]);
  });

  test("saving the passphrase puts the focus on the Passphrase set line, which is a status <output> (S6819)", async () => {
    const { store } = open();
    await press("Choose folder");
    await choose("Every day");
    await type(PASS);
    await press("Use it");
    await waitFor(() => store.backupScheduler.hasPassphrase || undefined, "the passphrase");
    const line = screen.queryByText("Passphrase set until you close Flightdeck.");
    // An <output> is a status by itself: it carries no role attribute.
    expect([
      line !== null && document.activeElement === line,
      line?.tagName,
      line?.getAttribute("role") ?? null,
      screen.queryByRole("status") === line,
    ]).toEqual([true, "OUTPUT", null, true]);
  });

  test("choosing Off while the form is open does not move the focus", async () => {
    open();
    await press("Choose folder");
    await choose("Every day");
    await choose("Off");
    expect([passphraseField() === null, document.activeElement === radio("Off")]).toEqual([
      true,
      true,
    ]);
  });

  test("with a passphrase already set, picking Every week shows no form and keeps the focus on the radio", async () => {
    const { store } = open();
    await press("Choose folder");
    await choose("Every day");
    await type(PASS);
    await press("Use it");
    await waitFor(() => store.backupScheduler.hasPassphrase || undefined, "the passphrase");
    await choose("Every week");
    expect([passphraseField() === null, document.activeElement === radio("Every week")]).toEqual([
      true,
      true,
    ]);
  });

  test("a schedule that is already waiting when the panel opens does not take the focus", () => {
    open({ due: true });
    expect([passphraseField() !== null, document.activeElement === passphraseField()]).toEqual([
      true,
      false,
    ]);
  });
});

describe("backup-schedule-focus-ui: a long folder path wraps (#2655)", () => {
  test("the folder path wraps anywhere", async () => {
    open({ folder: LONG_FOLDER });
    await press("Choose folder");
    const path = screen.queryByText(LONG_FOLDER, { exact: false });
    const classes = path?.closest("p")?.className.split(" ") ?? [];
    expect(classes.includes("[overflow-wrap:anywhere]")).toBe(true);
  });
});
