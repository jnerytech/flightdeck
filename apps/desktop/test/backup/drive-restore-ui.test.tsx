import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createBackup } from "../../src/features/backup/backup-bundle.ts";
import { registerDom } from "../dom.ts";
import { fakeGoogle } from "../fake-google.ts";
import { memoryPlatform, waitFor } from "../fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { TContext } = await import("../../src/i18n/context.tsx");
const { BackupAllPanel } = await import("../../src/features/backup/backup-all-panel.tsx");

setDefaultTimeout(30_000);
/**
 * Issue #1462: Settings > Back up everything can restore from Google Drive: look in Drive, pick a
 * backup, type its passphrase, and the same preview-then-confirm restore as a file. The choice is not
 * there without a client id, and says to sign in first when Google is not signed in.
 */
afterEach(cleanup);

const PASS = "correct horse battery";
const NAME = (day: number) =>
  `flightdeck-backup-202611${String(day).padStart(2, "0")}-120000.fdbackup`;

async function open(
  options: {
    language?: string;
    clientId?: string | null;
    signedIn?: boolean;
    files?: number[];
  } = {},
) {
  const source = memoryPlatform(false, "en");
  source.platform.storage.setItem("flightdeck.theme", "dark");
  const bundle = await createBackup(source.platform, PASS, PASS, { workFactor: 4 });

  const { platform } = memoryPlatform(false, options.language ?? "en");
  const google = fakeGoogle();
  const keyring = new Map<string, string>();
  platform.vault.get = async (id: string) => keyring.get(id) ?? null;
  platform.vault.set = async (id: string, value: string) => {
    keyring.set(id, value);
  };
  platform.vault.delete = async (id: string) => {
    keyring.delete(id);
  };
  platform.vault.canPick = true;
  platform.openExternal = async () => {};
  platform.oauthLoopback = {
    listen: async (state: string) => ({
      port: 4567,
      wait: async () => ({ code: "the-code", state }),
      cancel: () => {},
    }),
  };
  const clientId = options.clientId === undefined ? "client-1" : options.clientId;
  const store = new AppStore(platform, {
    baseDelayMs: 600_000,
    vaultWorkFactor: 4,
    google: { config: clientId === null ? null : { clientId }, fetch: google.fetch },
  });
  if (options.signedIn !== false) await store.backupScheduler.signInDrive();
  for (const day of options.files ?? [3, 9]) {
    google.drive.files.set(`f${day}`, {
      name: NAME(day),
      parents: ["appDataFolder"],
      text: bundle,
    });
  }
  store.i18n.start();
  render(
    <TContext.Provider value={store.i18n.t}>
      <BackupAllPanel store={store} />
    </TContext.Provider>,
  );
  return { store, platform };
}

const shown = (text: string) => screen.queryByText(text, { exact: false }) !== null;
const control = (name: string) =>
  screen.queryByRole("button", { name }) ?? screen.queryByLabelText(name);
async function click(name: string) {
  const found = control(name);
  if (found) await act(async () => fireEvent.click(found));
  return found !== null;
}
async function type(label: string, value: string) {
  const input = screen.queryByLabelText(label) as HTMLInputElement | null;
  if (input) await act(async () => fireEvent.change(input, { target: { value } }));
  return input !== null;
}

describe("backup-drive-restore-ui: restore from Google Drive (#1462)", () => {
  test("with no client id the restore is the file's alone and Drive is not mentioned", async () => {
    await open({ clientId: null });
    await waitFor(() => control("Read backup") !== null);
    expect([control("Read backup") !== null, shown("Google Drive")]).toEqual([true, false]);
  });

  test("look in Drive, pick a backup, read it, then the same preview and restore", async () => {
    const { platform } = await open();
    await waitFor(() => control("Google Drive") !== null);
    await click("Google Drive");
    await click("Look in Google Drive");
    await waitFor(() => control(NAME(9)) !== null);
    expect(control(NAME(9)) !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
    // Newest first, and both are offered.
    const labels = screen.queryAllByRole("radio").map((radio) => radio.parentElement?.textContent);
    expect(labels).toContain(NAME(9));
    expect(labels.indexOf(NAME(9))).toBeLessThan(labels.indexOf(NAME(3)));
    await click(NAME(9));
    await type("File passphrase", PASS);
    await click("Read backup");
    await waitFor(() => shown("Settings: 1 new"));
    expect(platform.storage.getItem("flightdeck.theme")).toBeNull();
    await click("Restore");
    await waitFor(() => shown("Restored: 1 new"));
    expect(platform.storage.getItem("flightdeck.theme")).toBe("dark");
  });

  test("picking another backup drops the preview of the one that was read", async () => {
    await open();
    await waitFor(() => control("Google Drive") !== null);
    await click("Google Drive");
    await click("Look in Google Drive");
    await waitFor(() => control(NAME(9)) !== null);
    await click(NAME(9));
    await type("File passphrase", PASS);
    await click("Read backup");
    await waitFor(() => shown("Settings: 1 new"));
    await click(NAME(3));
    expect(shown("Settings: 1 new")).toBe(false);
    expect(control("Restore")).toBeNull();
    // Looking again drops it too.
    await click(NAME(9));
    await type("File passphrase", PASS);
    await click("Read backup");
    await waitFor(() => shown("Settings: 1 new"));
    await click("Look in Google Drive");
    await waitFor(() => !shown("Settings: 1 new"));
    expect(control("Restore")).toBeNull();
  });

  test("a wrong passphrase is said and nothing is restored", async () => {
    const { platform } = await open();
    await waitFor(() => control("Google Drive") !== null);
    await click("Google Drive");
    await click("Look in Google Drive");
    await waitFor(() => control(NAME(9)) !== null);
    await click(NAME(9));
    await type("File passphrase", "not the passphrase");
    await click("Read backup");
    await waitFor(() => shown("could not be read"));
    expect([shown("Settings:"), platform.storage.getItem("flightdeck.theme")]).toEqual([
      false,
      null,
    ]);
  });

  test("an empty Drive says so", async () => {
    await open({ files: [] });
    await waitFor(() => control("Google Drive") !== null);
    await click("Google Drive");
    await click("Look in Google Drive");
    await waitFor(() => shown("No backups on Google Drive yet."));
    expect(shown("No backups on Google Drive yet.")).toBe(true);
  });

  test("not signed in to Google: it says to sign in first and offers no lookup", async () => {
    await open({ signedIn: false });
    await waitFor(() => control("Google Drive") !== null);
    await click("Google Drive");
    await waitFor(() => shown("Sign in to Google under Scheduled backups first."));
    expect(control("Look in Google Drive")).toBeNull();
  });

  test("the same screen in Portuguese", async () => {
    await open({ language: "pt-BR" });
    await waitFor(() => control("Google Drive") !== null);
    await click("Google Drive");
    await waitFor(() => control("Procurar no Google Drive") !== null);
    await click("Procurar no Google Drive");
    await waitFor(() => control(NAME(9)) !== null);
    expect(control(NAME(9)) !== null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });
});
