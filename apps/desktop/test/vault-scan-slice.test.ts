import { describe, expect, test } from "bun:test";
import { VaultScanSlice } from "../src/features/vault/index.ts";
import type { SecretMeta } from "../src/lib/vault.ts";

/** A scan over a vault stand-in: each secret's value by id, null for one the keyring has lost. */
function scan(secrets: Array<[Partial<SecretMeta>, string | null]>, fail = false) {
  const vault = {
    list: () => secrets.map(([meta], i) => ({ id: `s${i}`, ...meta }) as SecretMeta),
    value: async (id: string) => {
      if (fail) throw new Error("keychain locked");
      return secrets[Number(id.slice(1))]?.[1] ?? null;
    },
  };
  return new VaultScanSlice({ vault });
}

describe("vault scan slice", () => {
  test("a host's token is in the values at once, and a listener hears it", () => {
    const slice = scan([]);
    let heard = 0;
    slice.subscribe(() => heard++);
    slice.rememberToken("tok-abcdef-123456");
    expect(slice.values()).toEqual(["tok-abcdef-123456"]);
    expect([heard, slice.version]).toEqual([1, 1]);
  });

  test("the vault's values come line by line, an env set variable by variable, 6+ characters only", async () => {
    const slice = scan([
      [{ type: "token" }, "first-secret-line\nshort\r\nsecond-secret-line"],
      [
        { type: "env" },
        'API_KEY="env-value-one"\n# a comment line\nDB=tiny\n  TOKEN = spaced-value',
      ],
      [{ type: "token" }, null],
    ]);
    expect(await slice.vaultValues()).toEqual([
      "first-secret-line",
      "second-secret-line",
      "env-value-one",
      "# a comment line",
      "spaced-value",
    ]);
  });

  test("refresh learns the vault's values after the tokens, and the screens are told", async () => {
    const slice = scan([[{ type: "token" }, "vault-value-123456"]]);
    slice.rememberToken("tok-abcdef-123456");
    let heard = 0;
    const stop = slice.subscribe(() => heard++);
    await slice.refresh();
    expect(slice.values()).toEqual(["tok-abcdef-123456", "vault-value-123456"]);
    expect([heard, slice.version]).toEqual([1, 2]);
    stop();
    await slice.refresh();
    expect(heard).toBe(1);
  });

  test("a vault that cannot be read leaves the values the slice had", async () => {
    const slice = scan([[{ type: "token" }, "vault-value-123456"]], true);
    slice.rememberToken("tok-abcdef-123456");
    await slice.refresh();
    expect(slice.values()).toEqual(["tok-abcdef-123456"]);
    expect(slice.version).toBe(1);
  });
});
