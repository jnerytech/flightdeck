import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { DemoIds } from "../../demo-seed.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { backupExportShots, oversizedPersonas } from "../../lib/shots/table-backup-export.ts";
import { recordingPage } from "./recording-page.ts";

const shots = () => backupExportShots({} as DemoIds);

const SECTION = "evaluate text[Back up everything]";
const PASSPHRASE = 'fill "a long enough passphrase" label[Passphrase]';

/** Name → what the print drives on the page, in order, before it shows the section. */
const STEPS: Array<[string, string[]]> = [
  [
    "configuracoes-backup-erro-diferente",
    [
      PASSPHRASE,
      'fill "another long passphrase" label[Confirm passphrase]',
      "click button[Back up now]",
      "waitFor text[The passphrases do not match.]",
      SECTION,
    ],
  ],
  [
    "configuracoes-backup-erro-curta",
    [
      'fill "too short" label[Passphrase]',
      'fill "too short" label[Confirm passphrase]',
      "waitFor text[Type a passphrase of at least 12 characters and repeat it.]",
      SECTION,
    ],
  ],
  [
    "configuracoes-backup-erro-grande",
    [
      "evaluate ",
      PASSPHRASE,
      'fill "a long enough passphrase" label[Confirm passphrase]',
      "click button[Back up now]",
      "waitFor text[This backup is too big to be restored later]",
      SECTION,
    ],
  ],
];

describe("the Back up everything refusal prints (#4348)", () => {
  test("the table prints the passphrases that differ, the short one and the oversized backup", () => {
    expect(shots().map((shot) => shot.name)).toEqual(STEPS.map(([name]) => name));
  });

  test("each print is Settings > Backup with steps of its own", () => {
    expect(shots().map((shot) => [shot.route.name, shot.prepare !== undefined])).toEqual(
      STEPS.map(() => ["settings", true]),
    );
  });

  test("each print is re-measured narrow, where the form's fields and the notice must wrap", () => {
    expect(STEPS.map(([name]) => narrowSizes("dark", name).length)).toEqual(STEPS.map(() => 3));
  });

  test.each(STEPS)("%s drives the page the way its state needs", async (name, expected) => {
    const { page, steps } = recordingPage();
    const shot = shots().find((one) => one.name === name);
    expect(shot).toBeDefined();
    await shot?.prepare?.(page);
    expect(steps).toEqual(expected);
  });

  test("the oversized backup is over the 1 MiB the app reads back, and is a persona list", () => {
    const personas = JSON.parse(oversizedPersonas()) as Array<{ id: string }>;
    expect(personas.map((one) => one.id)).toEqual(["p-big"]);
    expect(oversizedPersonas().length).toBeGreaterThan(1024 * 1024);
  });

  test("demo:shots prints the table", () => {
    expect(readFileSync("scripts/demo-shots.ts", "utf8")).toContain("...backupExportShots(ids)");
  });
});
