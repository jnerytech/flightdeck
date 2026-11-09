import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { loadSchedule } from "../src/lib/backup-schedule.ts";
import { registerDom } from "./dom.ts";
import { memoryPlatform, waitFor } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { BackupSchedulePanel } = await import("../src/components/backup/backup-schedule-panel.tsx");

setDefaultTimeout(30_000);
/**
 * Issue #1264: Settings > Backup schedule. Off, daily or weekly; a folder from the dialog; how many
 * files to keep; the passphrase asked once per start and held in memory; a run that was owed and did
 * not go says why.
 */
afterEach(cleanup);

const PASS = "correct horse battery";

function open(options: { desktop?: boolean; language?: string; failWrite?: boolean } = {}) {
  const { platform } = memoryPlatform(false, options.language ?? "en");
  const files = new Map<string, string>();
  if (options.desktop !== false) {
    platform.backupFolder = {
      pick: async () => "/backups",
      current: async () => "/backups",
      write: async (name, text) => {
        if (options.failWrite) throw new Error("disk full");
        files.set(name, text);
      },
      list: async () => [...files.keys()],
      remove: async (name) => {
        files.delete(name);
      },
    };
  }
  const store = new AppStore(platform, { baseDelayMs: 600_000, vaultWorkFactor: 4 });
  store.i18n.start();
  render(
    <TContext.Provider value={store.i18n.t}>
      <BackupSchedulePanel store={store} />
    </TContext.Provider>,
  );
  return { platform, store, files };
}

const field = (label: string) => screen.queryByLabelText(label) as HTMLInputElement | null;
async function type(label: string, value: string) {
  const input = field(label);
  if (input) await act(async () => fireEvent.change(input, { target: { value } }));
  return input !== null;
}
async function click(name: string) {
  const button = screen.queryByRole("button", { name }) ?? screen.queryByLabelText(name);
  if (button) await act(async () => fireEvent.click(button));
  return button !== null;
}
const shown = (text: string) => screen.queryByText(text, { exact: false }) !== null;
const said = (text: string) =>
  screen.queryAllByRole("status").some((box) => (box.textContent ?? "").includes(text)) ||
  screen.queryAllByRole("alert").some((box) => (box.textContent ?? "").includes(text));

describe("backup-schedule-ui: Settings > Backup schedule (#1264)", () => {
  test("the web build shows nothing: a browser cannot write to a folder", () => {
    open({ desktop: false });
    expect([shown("Scheduled backups"), shown("Choose folder")]).toEqual([false, false]);
  });

  test("it starts off, with no folder and five files to keep", () => {
    open();
    expect([
      shown("Scheduled backups"),
      (field("Off") as HTMLInputElement | null)?.checked,
      shown("No folder chosen"),
      field("Files to keep")?.value,
    ]).toEqual([true, true, true, "5"]);
  });

  test("choosing a folder shows it and saves it; the cadence and the number to keep are saved", async () => {
    const { platform } = open();
    await click("Choose folder");
    await click("Every week");
    await type("Files to keep", "3");
    const saved = loadSchedule(platform.storage);
    expect([shown("/backups"), saved.cadence, saved.folder, saved.keep]).toEqual([
      true,
      "weekly",
      "/backups",
      3,
    ]);
  });

  test("a schedule that is on with no passphrase says the backup is waiting, and asks for it", async () => {
    open();
    await click("Choose folder");
    await click("Every day");
    expect([said("passphrase"), field("Passphrase for this session") !== null]).toEqual([
      true,
      true,
    ]);
  });

  // The print of #1328 met axe's target-size: a bare radio is under 24 px, and three stacked ones
  // leave no room around them. Each is a 24 px target, like the other radios of the app.
  test("each cadence radio is a target of at least 24 px", () => {
    open();
    const radios = ["Off", "Every day", "Every week"].map(
      (name) => screen.queryByRole("radio", { name }) as HTMLInputElement | null,
    );
    expect(radios.map((radio) => radio?.className.split(" ").includes("hit-control"))).toEqual([
      true,
      true,
      true,
    ]);
  });

  // The print of #1328 showed "Type it below" under the passphrase field: the notice comes first.
  test("the notice of a waiting backup comes before the passphrase field it points to", async () => {
    open();
    await click("Choose folder");
    await click("Every day");
    const notice = screen.queryByText(
      "A backup is due, but it waits for the passphrase. Type it below.",
    );
    const input = field("Passphrase for this session");
    expect(
      notice !== null &&
        input !== null &&
        (notice.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ).toBe(true);
  });

  test("a short passphrase is not accepted; a good one runs the backup, then the field goes away", async () => {
    const { files, platform, store } = open();
    await click("Choose folder");
    await click("Every day");
    await type("Passphrase for this session", "short");
    await click("Use it");
    const shortKept = store.backupScheduler.hasPassphrase;
    await type("Passphrase for this session", PASS);
    await click("Use it");
    await waitFor(() => files.size === 1 || undefined, "the backup file").catch(() => null);
    expect([
      shortKept,
      files.size,
      field("Passphrase for this session"),
      shown("Passphrase set"),
      shown("Last backup:"),
      loadSchedule(platform.storage).lastRunAt !== null,
    ]).toEqual([false, 1, null, true, true, true]);
  });

  // #1329: an invalid number snapped back to the saved one on blur, and nothing said why. Now the
  // field keeps what was typed and says, tied to it, what it takes and how many files are still kept.
  test("a number to keep that is not valid says why and what is still kept, after the field is left too; a valid one clears it", async () => {
    const { platform } = open();
    const input = field("Files to keep") as HTMLInputElement;
    const error = "Type a whole number from 1. The saved number (5) stays.";
    const says = () => {
      const line = screen.queryByText(error);
      return (
        line !== null &&
        input.getAttribute("aria-invalid") === "true" &&
        (input.getAttribute("aria-describedby") ?? "").split(" ").includes(line.id)
      );
    };
    await type("Files to keep", "0");
    await act(async () => fireEvent.blur(input));
    const afterZero = [says(), input.value, loadSchedule(platform.storage).keep];
    await type("Files to keep", "2.5");
    const afterFraction = says();
    await type("Files to keep", "3");
    const afterThree = [
      screen.queryByText(error) === null,
      input.hasAttribute("aria-invalid"),
      loadSchedule(platform.storage).keep,
    ];
    // What the number field takes as a whole number is saved and clears the message: one rule for both.
    await type("Files to keep", "2.0");
    expect([
      ...afterZero,
      afterFraction,
      ...afterThree,
      input.hasAttribute("aria-invalid"),
      loadSchedule(platform.storage).keep,
    ]).toEqual([true, "0", 5, true, true, false, 3, false, 2]);
  });

  test("a write that fails is shown, not hidden", async () => {
    open({ failWrite: true });
    await click("Choose folder");
    await click("Every day");
    await type("Passphrase for this session", PASS);
    await click("Use it");
    expect(said("could not be saved")).toBe(true);
  });

  test("the texts are in pt-BR too", () => {
    open({ language: "pt-BR" });
    expect([shown("Backups agendados"), shown("Escolher pasta")]).toEqual([true, true]);
  });

  test("in pt-BR an invalid number to keep says why too (#1329)", async () => {
    open({ language: "pt-BR" });
    await type("Arquivos a manter", "0");
    expect(
      shown("Digite um número inteiro a partir de 1. O número salvo (5) continua valendo."),
    ).toBe(true);
  });
});
