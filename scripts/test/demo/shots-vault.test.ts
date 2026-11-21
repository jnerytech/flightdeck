import { describe, expect, test } from "bun:test";
import { SecretMetaSchema } from "../../../apps/desktop/src/features/vault/domain/vault-types.ts";
import type { DemoIds } from "../../demo-seed.ts";
import { demoSecrets } from "../../lib/demo/seeds.ts";
import { hostShots } from "../../lib/shots/table-hosts.ts";

const IDS = {} as DemoIds;
const vaultShots = () => hostShots(IDS).filter((shot) => shot.name.startsWith("cofre-"));

describe("the vault's prints (#3602)", () => {
  test("the table prints each view of the vault, the Backup one among them", () => {
    expect(vaultShots().map((shot) => shot.name)).toEqual([
      "cofre-segredos",
      "cofre-vazio",
      "cofre-novo",
      "cofre-revelar",
      "cofre-uso",
      "cofre-backup",
      "cofre-relatorio",
    ]);
    expect(vaultShots().every((shot) => shot.route.name === "vault")).toBe(true);
  });

  test("the prints with rows seed the list; the empty one and Backup do not", () => {
    const seeded = vaultShots()
      .filter((shot) => shot.secrets === true)
      .map((shot) => shot.name);
    expect(seeded).toEqual(["cofre-segredos", "cofre-novo", "cofre-revelar", "cofre-uso"]);
  });

  test("the seeded list is valid secrets of every type, with no value in it", () => {
    const rows = JSON.parse(demoSecrets(new Date("2026-11-21T12:00:00Z"), "pt-BR")) as unknown[];
    const secrets = rows.map((row) => SecretMetaSchema.parse(row));
    expect(new Set(secrets.map((s) => s.type))).toEqual(
      new Set(["ssh-key", "password", "token", "env"]),
    );
    expect(secrets.some((s) => s.lastUsedAt === null)).toBe(true);
    expect(secrets.some((s) => s.lastUsedAt !== null)).toBe(true);
    for (const row of rows) expect(Object.keys(row as object)).not.toContain("value");
  });
});
