import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { DemoIds } from "../../demo-seed.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { backupDriveShots, backupScheduleShots } from "../../lib/shots/table-backup-drive.ts";
import { recordingPage } from "./recording-page.ts";

const shots = () => backupDriveShots({} as DemoIds);

/** Name → how the demo's Google answers for that print (`?google=`). */
const EXPECTED: Array<[string, string]> = [
  ["configuracoes-restaurar-fonte", "files"],
  ["configuracoes-restaurar-drive-entrar", "files"],
  ["configuracoes-restaurar-drive-lista", "files"],
  ["configuracoes-restaurar-drive-vazio", "empty"],
  ["configuracoes-restaurar-drive-auth", "revoked"],
  ["configuracoes-restaurar-drive-falhou", "down"],
];

describe("the Drive restore prints (#4348)", () => {
  test("the table prints the source choice, the sign-in warning, the list, an empty Drive and the two read errors", () => {
    expect(shots().map((shot) => shot.name)).toEqual(EXPECTED.map(([name]) => name));
  });

  test("each print is Settings > Backup with the demo's Google answering as its state needs", () => {
    // backupFolder=demo: the scheduled backups panel (Where to save, Sign in) is only there with a folder to write to.
    expect(
      shots().map((shot) => [
        shot.route.name,
        shot.query?.google,
        shot.query?.backupFolder,
        shot.prepare !== undefined,
      ]),
    ).toEqual(EXPECTED.map(([, mode]) => ["settings", mode, "demo", true]));
  });

  test("each print is re-measured narrow, where the source choice and the long file names must wrap", () => {
    expect(EXPECTED.map(([name]) => narrowSizes("dark", name).length)).toEqual(
      EXPECTED.map(() => 3),
    );
  });

  const SECTION = "evaluate text[Restore a backup]";
  const SIGNED_IN = [
    "check group[Where to save] > radio[Google Drive]",
    "click button[Sign in with Google]",
    "waitFor text[Signed in to Google]",
  ];
  const FROM_DRIVE = "check group[Restore from] > radio[Google Drive]";
  const LOOKED_IN = [...SIGNED_IN, FROM_DRIVE, "click button[Look in Google Drive]"];

  /** What each print drives on the page, in order, before it shows the section. */
  const STEPS: Array<[string, string[]]> = [
    ["configuracoes-restaurar-fonte", [SECTION]],
    [
      "configuracoes-restaurar-drive-entrar",
      [FROM_DRIVE, "waitFor text[Sign in to Google under]", SECTION],
    ],
    [
      "configuracoes-restaurar-drive-lista",
      [...LOOKED_IN, "waitFor text[flightdeck-backup-20261122-060000.fdbackup]", SECTION],
    ],
    [
      "configuracoes-restaurar-drive-vazio",
      [...LOOKED_IN, "waitFor text[No backups on Google Drive yet]", SECTION],
    ],
    [
      "configuracoes-restaurar-drive-auth",
      [...LOOKED_IN, "waitFor text[Google Drive does not accept]", SECTION],
    ],
    [
      "configuracoes-restaurar-drive-falhou",
      [...LOOKED_IN, "waitFor text[Google Drive could not be read]", SECTION],
    ],
  ];

  test.each(STEPS)("%s drives the page the way its state needs", async (name, expected) => {
    const { page, steps } = recordingPage();
    const shot = shots().find((one) => one.name === name);
    expect(shot).toBeDefined();
    await shot?.prepare?.(page);
    expect(steps).toEqual(expected);
  });

  test("demo:shots prints the table", () => {
    // Importing scripts/demo-shots.ts would count its untested browser code in the coverage gate.
    expect(readFileSync("scripts/demo-shots.ts", "utf8")).toContain("...backupDriveShots(ids)");
  });
});

/** Name → how the demo's Google answers for that print; the Keep print needs no Google at all. */
const SCHEDULE: Array<[string, string | undefined]> = [
  ["configuracoes-agendado-drive-saida", "files"],
  ["configuracoes-agendado-drive-conectado", "files"],
  ["configuracoes-agendado-drive-recusado", "refused"],
  ["configuracoes-agendado-drive-aguardando", "files"],
  ["configuracoes-agendado-manter-invalido", undefined],
];

describe("the scheduled backup prints (#4348)", () => {
  const prints = () => backupScheduleShots({} as DemoIds);

  test("the table prints Drive signed out, signed in, refused and waiting, and a Keep number that is not valid", () => {
    expect(prints().map((shot) => shot.name)).toEqual(SCHEDULE.map(([name]) => name));
  });

  test("each print is Settings > Backup with the demo's Google answering as its state needs", () => {
    // backupFolder=demo: the scheduled backups panel is only there with a folder to write to.
    expect(
      prints().map((shot) => [
        shot.route.name,
        shot.query?.google,
        shot.query?.backupFolder,
        shot.prepare !== undefined,
      ]),
    ).toEqual(SCHEDULE.map(([, mode]) => ["settings", mode, "demo", true]));
  });

  test("each print is re-measured narrow, where the target choice and the notices must wrap", () => {
    expect(SCHEDULE.map(([name]) => narrowSizes("dark", name).length)).toEqual(
      SCHEDULE.map(() => 3),
    );
  });

  const SECTION = "evaluate text[Scheduled backups]";
  const DRIVE_TARGET = "check group[Where to save] > radio[Google Drive]";

  /** What each print drives on the page, in order, before it shows the section. */
  const STEPS: Array<[string, string[]]> = [
    [
      "configuracoes-agendado-drive-saida",
      [DRIVE_TARGET, "waitFor text[Not signed in to Google]", SECTION],
    ],
    [
      "configuracoes-agendado-drive-conectado",
      [
        DRIVE_TARGET,
        "click button[Sign in with Google]",
        "waitFor text[Signed in to Google]",
        "waitFor text[Signed in to Google]",
        SECTION,
      ],
    ],
    [
      "configuracoes-agendado-drive-recusado",
      [
        DRIVE_TARGET,
        "click button[Sign in with Google]",
        "waitFor text[Google did not accept the sign-in. Try again.]",
        SECTION,
      ],
    ],
    [
      "configuracoes-agendado-drive-aguardando",
      [
        DRIVE_TARGET,
        "check radio[Every day]",
        'fill "a long enough passphrase" label[Passphrase for this session]',
        "click button[Set passphrase]",
        "waitFor text[Next backup: waiting for you to sign in to Google Drive.]",
        SECTION,
      ],
    ],
    [
      "configuracoes-agendado-manter-invalido",
      ['fill "0" label[Files to keep]', "waitFor text[Type a whole number from 1.]", SECTION],
    ],
  ];

  test.each(STEPS)("%s drives the page the way its state needs", async (name, expected) => {
    const { page, steps } = recordingPage();
    const shot = prints().find((one) => one.name === name);
    expect(shot).toBeDefined();
    await shot?.prepare?.(page);
    expect(steps).toEqual(expected);
  });

  test("demo:shots prints the table", () => {
    expect(readFileSync("scripts/demo-shots.ts", "utf8")).toContain("...backupScheduleShots(ids)");
  });
});
