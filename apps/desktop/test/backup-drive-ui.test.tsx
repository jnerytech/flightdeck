import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { REFRESH_TOKEN_ID } from "../src/lib/google-oauth.ts";
import { registerDom } from "./dom.ts";
import { fakeGoogle } from "./fake-google.ts";
import { memoryPlatform, waitFor } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { BackupSchedulePanel } = await import("../src/components/backup/backup-schedule-panel.tsx");

setDefaultTimeout(30_000);
/**
 * Issue #1444: Settings > Backup schedule can send the backups to Google Drive. The choice is not
 * shown at all while no client id is configured; with one, it offers the folder or Drive, and Drive
 * shows whether Google is signed in, with the button to sign in or out.
 */
afterEach(cleanup);

function open(options: { google?: boolean; language?: string; forged?: boolean } = {}) {
  const { platform } = memoryPlatform(false, options.language ?? "en");
  const google = fakeGoogle();
  const keyring = new Map<string, string>();
  const opened: string[] = [];
  platform.vault.get = async (id: string) => keyring.get(id) ?? null;
  platform.vault.set = async (id: string, value: string) => {
    keyring.set(id, value);
  };
  platform.vault.delete = async (id: string) => {
    keyring.delete(id);
  };
  platform.openExternal = async (url: string) => {
    opened.push(url);
  };
  platform.backupFolder = {
    pick: async () => "/backups",
    current: async () => "/backups",
    write: async () => {},
    list: async () => [],
    remove: async () => {},
  };
  platform.oauthLoopback = {
    listen: async () => ({
      port: 4567,
      wait: async () => ({
        code: "the-code",
        state: options.forged
          ? "forged"
          : (new URL(opened.at(-1) ?? "http://x").searchParams.get("state") ?? ""),
      }),
      cancel: () => {},
    }),
  };
  const store = new AppStore(platform, {
    baseDelayMs: 600_000,
    vaultWorkFactor: 4,
    google: {
      config: options.google === false ? null : { clientId: "client-1" },
      fetch: google.fetch,
    },
  });
  store.i18n.start();
  render(
    <TContext.Provider value={store.i18n.t}>
      <BackupSchedulePanel store={store} />
    </TContext.Provider>,
  );
  return { store, keyring };
}

const shown = (text: string) => screen.queryByText(text, { exact: false }) !== null;
const radio = (name: string) => screen.queryByLabelText(name) as HTMLInputElement | null;
async function click(name: string) {
  const button = screen.queryByRole("button", { name }) ?? screen.queryByLabelText(name);
  if (button) await act(async () => fireEvent.click(button));
  return button !== null;
}

describe("backup-drive-ui: Google Drive in Settings > Backup schedule (#1444)", () => {
  test("with no client id the folder is the only place and Drive is not mentioned", async () => {
    open({ google: false });
    await waitFor(() => shown("Choose folder"));
    expect([shown("Choose folder"), shown("Google Drive"), shown("Sign in with Google")]).toEqual([
      true,
      false,
      false,
    ]);
  });

  test("with a client id the person can pick the folder or Drive", async () => {
    open();
    await waitFor(() => shown("Choose folder"));
    expect([radio("A folder")?.checked, radio("Google Drive")?.checked]).toEqual([true, false]);
  });

  test("choosing Drive swaps the folder for the sign-in, which starts signed out", async () => {
    open();
    await waitFor(() => radio("Google Drive") !== null);
    await click("Google Drive");
    await waitFor(() => shown("Not signed in to Google"));
    expect([shown("Choose folder"), shown("Not signed in to Google")]).toEqual([false, true]);
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  test("signing in shows it and keeps the token in the vault; signing out removes it", async () => {
    const { keyring } = open();
    await waitFor(() => radio("Google Drive") !== null);
    await click("Google Drive");
    await click("Sign in with Google");
    await waitFor(() => screen.queryByRole("button", { name: "Sign out" }) !== null);
    expect(shown("Not signed in to Google")).toBe(false);
    expect([...keyring.keys()]).toEqual([REFRESH_TOKEN_ID]);
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeNull();
    await click("Sign out");
    await waitFor(() => shown("Not signed in to Google"));
    expect(keyring.size).toBe(0);
  });

  test("a redirect Google's page did not send is refused and says so", async () => {
    const { keyring } = open({ forged: true });
    await waitFor(() => radio("Google Drive") !== null);
    await click("Google Drive");
    await click("Sign in with Google");
    await waitFor(() => shown("did not accept the sign-in"));
    expect([shown("Not signed in to Google"), keyring.size]).toEqual([true, 0]);
  });

  test("the same screen in Portuguese", async () => {
    open({ language: "pt-BR" });
    await waitFor(() => radio("Google Drive") !== null);
    await click("Google Drive");
    await waitFor(() => shown("Não conectado ao Google"));
    expect(screen.queryByRole("button", { name: "Entrar com o Google" })).not.toBeNull();
  });
});
