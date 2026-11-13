import { describe, expect, test } from "bun:test";
import {
  type BackupPlatform,
  createBackup,
  previewRestore,
} from "../../src/features/backup/backup-bundle.ts";
import { loadSchedule, SCHEDULE_KEY } from "../../src/features/backup/backup-schedule.ts";

/** An empty profile whose app storage holds what a test plants. */
function profileWith(entries: Record<string, string>): BackupPlatform {
  const items = new Map(Object.entries(entries));
  return {
    storage: {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => {
        items.set(key, value);
      },
    },
    secrets: { get: async () => null, set: async () => {}, delete: async () => {} },
    vault: {} as never,
  } as BackupPlatform;
}

const PASS = "correct horse battery";
const FAST = { workFactor: 4, clock: () => Date.UTC(2026, 10, 12) };

describe("the backup's stored values are parsed, not trusted (#1609)", () => {
  test("a persona that is not an item is left out of the backup and the others stay", async () => {
    const planted = profileWith({
      "flightdeck.personas": JSON.stringify([{ id: "p1", name: "Reviewer" }, "junk", { id: 7 }]),
    });
    const file = await createBackup(planted, PASS, PASS, FAST);
    const preview = await previewRestore(profileWith({}), file, PASS);
    expect([...preview.personas.added]).toEqual(["Reviewer"]);
  });

  test("a snippet list that is not a list is backed up as empty", async () => {
    const planted = profileWith({ "flightdeck.snippets": '{"id":"s1"}' });
    const file = await createBackup(planted, PASS, PASS, FAST);
    const preview = await previewRestore(profileWith({}), file, PASS);
    expect(preview.snippets.added).toHaveLength(0);
  });

  test("a schedule whose fields are of the wrong type reads as the default, field by field", () => {
    const storage = profileWith({
      [SCHEDULE_KEY]: JSON.stringify({
        cadence: "daily",
        target: 3,
        folder: ["x"],
        keep: 0,
        lastRunAt: "yesterday",
      }),
    }).storage;
    expect(loadSchedule(storage)).toEqual({
      cadence: "daily",
      target: "folder",
      folder: "",
      keep: 5,
      lastRunAt: null,
    });
  });
});
