import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { DemoIds } from "../../demo-seed.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { backupFailShots } from "../../lib/shots/table-backup-fail.ts";
import { recordingPage } from "./recording-page.ts";

const shots = () => backupFailShots({} as DemoIds);

/** The steps of a backup taken: the save and file stubs, the personas, the passphrase, Back up now. */
const BACKED_UP = [
  "evaluate ",
  "evaluate ",
  "evaluate ",
  'fill "a long enough passphrase" label[Passphrase]',
  'fill "a long enough passphrase" label[Confirm passphrase]',
  "click button[Back up now]",
  "waitFor text[Backup saved]",
];
const READ = [
  'fill "a long enough passphrase" label[File passphrase]',
  "click button[Read backup]",
];
const RESTORE_SECTION = "evaluate text[Restore a backup]";
const AWAY = "mouse.move 1000,700";

/** Name → what the print drives on the page, in order, before it shows the section. */
const STEPS: Array<[string, string[]]> = [
  [
    "configuracoes-backup-restaurar-falhou",
    [
      ...BACKED_UP,
      "evaluate ",
      ...READ,
      "evaluate ",
      "click button[Restore]",
      AWAY,
      "waitFor text[The restore failed and nothing was changed.]",
      RESTORE_SECTION,
    ],
  ],
  [
    "configuracoes-backup-nada-a-restaurar",
    [
      ...BACKED_UP,
      ...READ,
      "waitFor text[Nothing here is new. Choose to replace a difference to restore it.]",
      RESTORE_SECTION,
    ],
  ],
  [
    "configuracoes-agenda-limpeza-falhou",
    [
      "evaluate ",
      "check radio[Every day]",
      "click button[Choose folder]",
      "waitFor text[/demo/backups]",
      "evaluate ",
      'fill "1" label[Files to keep]',
      'fill "a long enough passphrase" label[Passphrase for this session]',
      "click button[Set passphrase]",
      "waitFor text[The backup was saved, but the old files could not be removed.]",
      "evaluate text[Scheduled backups]",
    ],
  ],
];

describe("the Backup failure prints (#4348)", () => {
  test("the table prints the failed restore, the nothing-to-restore backup and the failed prune", () => {
    expect(shots().map((shot) => shot.name)).toEqual(STEPS.map(([name]) => name));
  });

  test("each print is Settings > Backup with steps of its own", () => {
    expect(shots().map((shot) => [shot.route.name, shot.prepare !== undefined])).toEqual(
      STEPS.map(() => ["settings", true]),
    );
  });

  test("the failed prune opens with the demo folder, the others without it", () => {
    expect(shots().map((shot) => shot.query?.backupFolder)).toEqual([undefined, undefined, "demo"]);
  });

  test("each print is re-measured narrow, where the notice and the reason must wrap", () => {
    expect(STEPS.map(([name]) => narrowSizes("dark", name).length)).toEqual(STEPS.map(() => 3));
  });

  test.each(STEPS)("%s drives the page the way its state needs", async (name, expected) => {
    const { page, steps } = recordingPage();
    const shot = shots().find((one) => one.name === name);
    expect(shot).toBeDefined();
    await shot?.prepare?.(page);
    expect(steps).toEqual(expected);
  });

  test("demo:shots prints the table", () => {
    expect(readFileSync("scripts/demo-shots.ts", "utf8")).toContain("...backupFailShots(ids)");
  });
});
