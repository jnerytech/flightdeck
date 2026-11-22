import { describe, expect, test } from "bun:test";
import { SecretMetaSchema } from "../../../apps/desktop/src/features/vault/domain/vault-types.ts";
import type { DemoIds } from "../../demo-seed.ts";
import { demoSecrets, demoVaultUsage } from "../../lib/demo/seeds.ts";
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
      "cofre-copiar",
      "cofre-editar",
      "cofre-regras",
      "cofre-remover",
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
    expect(seeded).toEqual([
      "cofre-segredos",
      "cofre-novo",
      "cofre-revelar",
      "cofre-editar",
      "cofre-regras",
      "cofre-remover",
      "cofre-uso",
    ]);
  });

  test("the seeded list is valid secrets of every type, with no value in it", () => {
    const rows = JSON.parse(demoSecrets("demo-alfa")) as unknown[];
    const secrets = rows.map((row) => SecretMetaSchema.parse(row));
    expect(new Set(secrets.map((s) => s.type))).toEqual(
      new Set(["ssh-key", "password", "token", "env"]),
    );
    expect(secrets.some((s) => s.lastUsedAt === null)).toBe(true);
    expect(secrets.some((s) => s.lastUsedAt !== null)).toBe(true);
    for (const row of rows) expect(Object.keys(row as object)).not.toContain("value");
  });

  test("the Usage print seeds a log of the listed secrets, delivered and refused, with no value", () => {
    const listed = new Set(
      (JSON.parse(demoSecrets("demo-alfa")) as { id: string }[]).map((s) => s.id),
    );
    const lines = JSON.parse(demoVaultUsage("demo-alfa")) as Record<string, unknown>[];
    expect(lines.every((l) => listed.has(String(l.secretId)))).toBe(true);
    expect(new Set(lines.map((l) => l.kind))).toEqual(new Set(["delivered", "denied"]));
    for (const l of lines) expect(Object.keys(l)).not.toContain("value");
    expect(vaultShots().find((s) => s.name === "cofre-uso")?.vaultUsage).toBe(true);
  });

  // #3944: every row of the print read "Unknown" because the seed's requester was "session", which
  // is none of the requesters the log knows.
  test("the Usage print seeds each requester the log knows, one line each, and none reads Unknown", () => {
    const lines = JSON.parse(demoVaultUsage("demo-alfa")) as { requester: string }[];
    expect(lines.map((l) => l.requester).sort((a, b) => a.localeCompare(b))).toEqual([
      "automation",
      "claude",
      "workflow",
      "you",
    ]);
  });

  test("the Usage lines name a purpose and a secret of the list, delivered or denied", () => {
    const listed = new Set(
      (JSON.parse(demoSecrets("demo-alfa")) as { id: string }[]).map((s) => s.id),
    );
    const lines = JSON.parse(demoVaultUsage("demo-alfa")) as {
      secretId: string;
      purpose: string;
      kind: string;
    }[];
    expect(
      lines.every(
        (l) =>
          l.purpose !== "" && listed.has(l.secretId) && ["delivered", "denied"].includes(l.kind),
      ),
    ).toBe(true);
  });

  test("the Copy print seeds no secrets and has a prepare step of its own", () => {
    const copy = vaultShots().find((s) => s.name === "cofre-copiar");
    expect([copy?.secrets, copy?.prepare === undefined]).toEqual([undefined, false]);
  });
});
