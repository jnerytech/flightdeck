import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { DemoIds } from "../../demo-seed.ts";
import { narrowSizes } from "../../lib/shots/narrow.ts";
import { backupDriveShots, backupScheduleShots } from "../../lib/shots/table-backup-drive.ts";

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
    expect(
      shots().map((shot) => [shot.route.name, shot.query?.google, shot.prepare !== undefined]),
    ).toEqual(EXPECTED.map(([, mode]) => ["settings", mode, true]));
  });

  test("each print is re-measured narrow, where the source choice and the long file names must wrap", () => {
    expect(EXPECTED.map(([name]) => narrowSizes("dark", name).length)).toEqual(
      EXPECTED.map(() => 3),
    );
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
    expect(
      prints().map((shot) => [shot.route.name, shot.query?.google, shot.prepare !== undefined]),
    ).toEqual(SCHEDULE.map(([, mode]) => ["settings", mode, true]));
  });

  test("each print is re-measured narrow, where the target choice and the notices must wrap", () => {
    expect(SCHEDULE.map(([name]) => narrowSizes("dark", name).length)).toEqual(
      SCHEDULE.map(() => 3),
    );
  });

  test("demo:shots prints the table", () => {
    expect(readFileSync("scripts/demo-shots.ts", "utf8")).toContain("...backupScheduleShots(ids)");
  });
});
