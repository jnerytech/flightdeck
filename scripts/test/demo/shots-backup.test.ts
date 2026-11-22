import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { keepSaves, type SaveWindow } from "../../lib/shots/save-file.ts";
import { hostShots } from "../../lib/shots/table-hosts.ts";

const IDS = {} as DemoIds;
const backupShots = () =>
  hostShots(IDS).filter((shot) => shot.name.startsWith("configuracoes-backup-"));

type Handle = {
  createWritable(): Promise<{ write(text: string): Promise<void>; close(): Promise<void> }>;
};
type Picker = (options: { suggestedName: string }) => Promise<Handle>;

describe("the Back up everything prints (#4001)", () => {
  test("the table prints the schedule, the filled export form and the saved backup, all on Settings > Backup", () => {
    expect(backupShots().map((shot) => shot.name)).toEqual([
      "configuracoes-backup-agenda",
      "configuracoes-backup-exportar",
      "configuracoes-backup-salvo",
    ]);
    expect(
      backupShots().every((shot) => shot.route.name === "settings" && shot.prepare !== undefined),
    ).toBe(true);
  });

  test("a save keeps the name the app suggested and the text it wrote", async () => {
    const win: SaveWindow = {};
    keepSaves(win);
    const picker = win.showSaveFilePicker as Picker;
    const handle = await picker({ suggestedName: "flightdeck-backup.fdbackup" });
    const writable = await handle.createWritable();
    await writable.write("-----BEGIN AGE ENCRYPTED FILE-----");
    await writable.close();
    expect(win.__saved).toEqual({
      name: "flightdeck-backup.fdbackup",
      text: "-----BEGIN AGE ENCRYPTED FILE-----",
    });
  });
});
