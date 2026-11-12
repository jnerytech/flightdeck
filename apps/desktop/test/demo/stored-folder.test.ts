import { expect, test } from "bun:test";
import { DEMO_BACKUP_FOLDER_KEY, demoBackupFolder } from "../../src/demo/boot.ts";
import { memoryPlatform } from "../fixtures.ts";

const NAME = "flightdeck-backup-20261108-120000.fdbackup";

const state = async (stored: string | null) => {
  const { platform } = memoryPlatform();
  if (stored !== null) platform.storage.setItem(DEMO_BACKUP_FOLDER_KEY, stored);
  const folder = demoBackupFolder(platform);
  return { chosen: (await folder.current()) !== null, files: await folder.list() };
};

test("a stored demo folder that is not JSON, or not an object, reads as no folder (#1609)", async () => {
  const none = { chosen: false, files: [] };
  expect(await state("not json")).toEqual(none);
  expect(await state("[1,2]")).toEqual(none);
  expect(await state(null)).toEqual(none);
});

test("a stored demo folder keeps its choice and its files when they fit (#1609)", async () => {
  const kept = JSON.stringify({ chosen: true, files: { [NAME]: "text" } });
  expect(await state(kept)).toEqual({ chosen: true, files: [NAME] });
});

test("a stored demo folder with a wrong-typed part reads that part as empty (#1609)", async () => {
  expect(await state(JSON.stringify({ chosen: "yes", files: 7 }))).toEqual({
    chosen: false,
    files: [],
  });
});
