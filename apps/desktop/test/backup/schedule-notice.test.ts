import { describe, expect, test } from "bun:test";
import { SCHEDULE_KEY } from "../../src/features/backup/backup-schedule.ts";
import { AppStore } from "../../src/lib/app-store.ts";
import { memoryPlatform, waitFor } from "../fixtures.ts";

/**
 * Issue #1327: a person who picked "Every day" and never reopens Settings must still hear, in the
 * bell, that no backup is being made: the passphrase to type after a start, a folder to choose, a
 * write that failed. One notice per kind per app start; a click opens Settings > Backup schedule.
 */
const PASS = "correct horse battery";

function start(options: {
  language: string;
  folder: boolean;
  failWrite?: boolean;
  pass?: boolean;
}) {
  const mem = memoryPlatform(false, options.language);
  mem.items.set(
    SCHEDULE_KEY,
    JSON.stringify({
      cadence: "daily",
      folder: options.folder ? "/backups" : "",
      keep: 7,
      lastRunAt: null,
    }),
  );
  mem.platform.backupFolder = {
    pick: async () => "/backups",
    current: async () => (options.folder ? "/backups" : null),
    write: async () => {
      if (options.failWrite) throw new Error("disk full");
    },
    list: async () => [],
    remove: async () => {},
  };
  const store = new AppStore(mem.platform, { baseDelayMs: 600_000, vaultWorkFactor: 4 });
  return { mem, store };
}

const shown = (store: AppStore) =>
  store.getState().inbox.map((entry) => ({ title: entry.title, route: entry.route }));
const SETTINGS_BACKUP = { name: "settings", section: "backup" } as const;

describe("backup-schedule-notice (#1327)", () => {
  test("a start with the schedule on and no passphrase puts one notice in the bell, opening the backup settings", async () => {
    const { store } = start({ language: "en", folder: true });
    await store.init();
    await waitFor(() => store.getState().inbox.length > 0 || undefined, "the notice").catch(
      () => null,
    );
    expect(shown(store)).toEqual([
      { title: "Scheduled backups need your passphrase", route: SETTINGS_BACKUP },
    ]);
    store.dispose();
  });

  test("the notice is in the person's language", async () => {
    const { store } = start({ language: "pt-BR", folder: true });
    await store.init();
    await waitFor(() => store.getState().inbox.length > 0 || undefined, "the notice").catch(
      () => null,
    );
    expect(shown(store).map((entry) => entry.title)).toEqual([
      "Os backups agendados precisam da sua frase-senha",
    ]);
    store.dispose();
  });

  test("a start with no folder tells so, and the passphrase is not what is asked", async () => {
    const { store } = start({ language: "en", folder: false });
    await store.init();
    await waitFor(() => store.getState().inbox.length > 0 || undefined, "the notice").catch(
      () => null,
    );
    expect(shown(store).map((entry) => entry.title)).toEqual(["Scheduled backups have no folder"]);
    store.dispose();
  });

  test("the passphrase is never put in a notice", async () => {
    const { store, mem } = start({ language: "en", folder: true });
    await store.init();
    // The notice that asks for the passphrase is there first, so the dump below has one to leak from.
    await waitFor(() => store.getState().inbox.length > 0 || undefined, "the notice");
    await store.backupScheduler.setPassphrase(PASS);
    expect(store.backupScheduler.hasPassphrase).toBe(true);
    const stored = mem.items.get(SCHEDULE_KEY) ?? "";
    expect(stored).toContain('"cadence":"daily"');
    const kept = JSON.stringify([...mem.items.values(), store.getState().inbox]);
    expect(kept).toContain("Scheduled backups need your passphrase");
    expect(kept.includes(PASS)).toBe(false);
    store.dispose();
  });
});
