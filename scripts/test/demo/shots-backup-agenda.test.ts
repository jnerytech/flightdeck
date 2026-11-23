import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { failFolderWrites, type StorageWindow } from "../../lib/shots/folder-fail.ts";
import { hostShots } from "../../lib/shots/table-hosts.ts";

const agendaShots = () =>
  hostShots({} as DemoIds).filter(
    (shot) =>
      shot.name === "configuracoes-backup-agenda" || shot.name.startsWith("configuracoes-agenda-"),
  );

describe("the Scheduled backups prints (#4001)", () => {
  test("the table prints the schedule, the run done, a missing folder and a failed write, all with the demo folder", () => {
    expect(agendaShots().map((shot) => shot.name)).toEqual([
      "configuracoes-backup-agenda",
      "configuracoes-agenda-feito",
      "configuracoes-agenda-sem-pasta",
      "configuracoes-agenda-falhou",
    ]);
    expect(
      agendaShots().every(
        (shot) => shot.query?.backupFolder === "demo" && shot.prepare !== undefined,
      ),
    ).toBe(true);
  });

  describe("a folder that cannot be written", () => {
    const fakeWindow = () => {
      const written: string[] = [];
      const win: StorageWindow = {
        Storage: {
          prototype: {
            setItem(_key: string, value: string) {
              written.push(value);
            },
          },
        },
      };
      return { win, written };
    };

    test("the key of the folder refuses its write", () => {
      const { win, written } = fakeWindow();
      failFolderWrites(win, "flightdeck.demoBackupFolder");
      expect(() =>
        win.Storage.prototype.setItem.call({}, "flightdeck.demoBackupFolder", "files"),
      ).toThrow();
      expect(written).toEqual([]);
    });

    test("the first writes pass when some are allowed, and the next ones refuse", () => {
      const { win, written } = fakeWindow();
      failFolderWrites(win, "flightdeck.demoBackupFolder", 1);
      const write = (value: string) =>
        win.Storage.prototype.setItem.call({}, "flightdeck.demoBackupFolder", value);
      expect(() => write("saved")).not.toThrow();
      expect(() => write("pruned")).toThrow();
      expect(() => write("pruned again")).toThrow();
      expect(written).toEqual(["saved"]);
    });

    test("any other key is written as before", () => {
      const { win, written } = fakeWindow();
      failFolderWrites(win, "flightdeck.demoBackupFolder");
      win.Storage.prototype.setItem.call({}, "flightdeck.backupSchedule", "daily");
      expect(written).toEqual(["daily"]);
    });
  });
});
