import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { DemoIds } from "../../demo-seed.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { vaultBackupShots } from "../../lib/shots/table-vault-backup.ts";
import { recordingPage } from "./recording-page.ts";

const shots = () => vaultBackupShots({} as DemoIds);

const PHRASE = "a long enough passphrase";
/** The pointer leaves the button it clicked: its hover color is not what the contrast check should see. */
const AWAY = "mouse.move 1000,700";
const IMPORT_SECTION = "evaluate text[Import vault]";

const store = (name: string, value: string) => [
  "click button[New secret]",
  `fill "${name}" label[Name]`,
  `fill "${value}" label[Value]`,
  "click button[Save]",
  "waitFor button[Edit]",
];
/** The save and file stubs: the file the export saves is the one the import opens. */
const KEPT_FILES = ["evaluate ", "evaluate "];
const EXPORT = [
  "click tab[Backup]",
  `fill "${PHRASE}" label[Passphrase]`,
  `fill "${PHRASE}" label[Confirm passphrase]`,
  "click button[Export vault]",
  AWAY,
  "waitFor text[Vault saved as cofre.fdvault]",
];
/** One secret edited after the backup, so reading it back finds it different. */
const EDITED = [
  "click tab[Secrets]",
  "click button[Edit]",
  'fill "changed after the backup" label[Description]',
  "click button[Save changes]",
  AWAY,
  "waitFor button[Save changes]",
  "click tab[Backup]",
];
const BACKED_UP_THEN_EDITED = [
  ...KEPT_FILES,
  ...store("demo-token", "demo-not-a-real-token"),
  ...store("demo-other", "demo-other-value"),
  ...EXPORT,
  ...EDITED,
];
const previewed = (phrase: string, wait: string) => [
  `fill "${phrase}" label[File passphrase]`,
  "click button[Import vault]",
  AWAY,
  wait,
];
const PREVIEW = previewed(PHRASE, "waitFor text[Conflicting]");
const REPLACE_ASKED = [
  ...BACKED_UP_THEN_EDITED,
  ...PREVIEW,
  "check radio[Replace with the backup]",
  "click button[Apply]",
  AWAY,
  "waitFor alertdialog[]",
];

/** Name → what the print drives on the page, in order. */
const STEPS: Array<[string, string[]]> = [
  [
    "cofre-backup-exportado",
    [
      ...KEPT_FILES,
      ...store("demo-token", "demo-not-a-real-token"),
      ...EXPORT,
      "evaluate text[Export vault]",
    ],
  ],
  ["cofre-backup-previa", [...BACKED_UP_THEN_EDITED, ...PREVIEW, IMPORT_SECTION]],
  [
    "cofre-backup-frase-errada",
    [
      ...BACKED_UP_THEN_EDITED,
      ...previewed("not the passphrase at all", "waitFor text[The file could not be read.]"),
      IMPORT_SECTION,
    ],
  ],
  ["cofre-backup-substituir", REPLACE_ASKED],
  [
    "cofre-backup-resultado",
    [
      ...REPLACE_ASKED,
      "click button[Replace secrets]",
      AWAY,
      "waitFor text[Added: 0, replaced: 1, kept: 0.]",
      IMPORT_SECTION,
    ],
  ],
];

describe("the Vault > Backup prints (#4348)", () => {
  test("the table prints the exported message, the preview, a wrong passphrase, the Replace dialog and the result", () => {
    expect(shots().map((shot) => shot.name)).toEqual(STEPS.map(([name]) => name));
  });

  test("each print is the Vault with steps of its own", () => {
    expect(shots().map((shot) => [shot.route.name, shot.prepare !== undefined])).toEqual(
      STEPS.map(() => ["vault", true]),
    );
  });

  test("each print is re-measured narrow, where the notice and the buttons must wrap", () => {
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
    expect(readFileSync("scripts/demo-shots.ts", "utf8")).toContain("...vaultBackupShots(ids)");
  });
});
