import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createBackup } from "../../src/features/backup/backup-bundle.ts";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";
import { settleMaybe } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { BackupAllPanel } = await import("../../src/features/backup/backup-all-panel.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #4347: Settings > Backup. The export stays off, and says why, until the passphrase has its
 * 12 characters; the restore says a file picker opens and the preview names the file it read.
 */
const PASS = "correct horse battery";

type Lang = "en" | "pt-BR";
const WORDS = {
  en: {
    pass: "Passphrase",
    confirm: "Confirm passphrase",
    export: "Back up now",
    needs: "Type a passphrase of at least 12 characters and repeat it.",
    filePass: "File passphrase",
    read: "Read backup",
    pickerHelp: "A file picker opens when you press Read backup.",
    source: (name: string) => `File read: ${name}`,
  },
  "pt-BR": {
    pass: "Frase-senha",
    confirm: "Confirmar frase-senha",
    export: "Fazer backup agora",
    needs: "Digite uma frase-senha de pelo menos 12 caracteres e repita-a.",
    filePass: "Frase-senha do arquivo",
    read: "Ler backup",
    pickerHelp: "Um seletor de arquivos abre quando você aperta Ler backup.",
    source: (name: string) => `Arquivo lido: ${name}`,
  },
} as const;

async function backupText(): Promise<string> {
  const { platform } = memoryPlatform(false, "en");
  platform.storage.setItem("flightdeck.theme", "dark");
  return createBackup(platform, PASS, PASS, { workFactor: 4 });
}

function open(lang: Lang, pickedPath: string | null = null, text: string | null = null) {
  const { platform } = memoryPlatform(false, lang);
  // The fixture is the web platform, which has no file dialog; these tests stand in for the desktop.
  platform.vault.canPick = true;
  platform.vault.pickFile = async () =>
    pickedPath === null || text === null ? null : { path: pickedPath, text };
  const store = new AppStore(platform, { baseDelayMs: 600_000, vaultWorkFactor: 4 });
  store.i18n.start();
  render(
    <TContext.Provider value={store.i18n.t}>
      <BackupAllPanel store={store} />
    </TContext.Provider>,
  );
  return WORDS[lang];
}

const field = (label: string) => screen.queryByLabelText(label) as HTMLInputElement | null;
async function type(label: string, value: string) {
  const input = field(label);
  expect(input).not.toBeNull();
  await act(async () => fireEvent.change(input as HTMLElement, { target: { value } }));
}
const button = (name: string) => screen.queryByRole("button", { name }) as HTMLButtonElement | null;

describe.each(["en", "pt-BR"] as const)("backup-all-ui: the floor and the file (%s)", (lang) => {
  test("the export is off, with the reason, below 12 characters and on at 12 that match", async () => {
    const w = open(lang);
    await type(w.pass, "short");
    await type(w.confirm, "short");
    const short = {
      disabled: button(w.export)?.disabled,
      reason: screen.queryByText(w.needs) !== null,
    };
    await type(w.pass, PASS);
    await type(w.confirm, PASS);
    const good = {
      disabled: button(w.export)?.disabled,
      reason: screen.queryByText(w.needs) !== null,
    };
    expect({ short, good }).toEqual({
      short: { disabled: true, reason: true },
      good: { disabled: false, reason: false },
    });
  });

  test("a passphrase that is long enough but does not match is still refused with its reason", async () => {
    const w = open(lang);
    await type(w.pass, PASS);
    await type(w.confirm, `${PASS}x`);
    await act(async () => fireEvent.click(button(w.export) as HTMLElement));
    const refused = await settleMaybe(
      () => screen.queryAllByRole("alert").some((box) => (box.textContent ?? "") !== ""),
      3000,
    );
    expect(refused).toBe(true);
  });

  test("the file passphrase says a file picker opens when Read backup is pressed", () => {
    const w = open(lang);
    const input = field(w.filePass) as HTMLElement;
    const help = document.getElementById(input.getAttribute("aria-describedby") ?? "");
    expect(help?.textContent).toBe(w.pickerHelp);
  });

  test("the preview names the file that was read, not its folder", async () => {
    const w = open(lang, "C:\\Users\\me\\backups\\work.fdbackup", await backupText());
    await type(w.filePass, PASS);
    await act(async () => fireEvent.click(button(w.read) as HTMLElement));
    const shown = await settleMaybe(
      () => screen.queryByText(w.source("work.fdbackup")) !== null,
      3000,
    );
    expect({ shown, folder: document.body.textContent?.includes("Users") }).toEqual({
      shown: true,
      folder: false,
    });
  });
});
