import { describe, expect, test } from "bun:test";
import { createBackup } from "../../src/features/backup/backup-bundle.ts";
import { memoryPlatform } from "../fixtures.ts";

const { AppStore } = await import("../../src/lib/app-store.ts");

const PASS = "correct horse battery";

describe("a restore and the vault's derived row details (#2636)", () => {
  test("a secret a restore overwrites is described from its restored value, not from the cached one", async () => {
    const mine = memoryPlatform();
    const store = new AppStore(mine.platform, { baseDelayMs: 60_000 });
    const meta = await store.secrets.add({
      name: "github",
      type: "token",
      value: "ghp_aaaaaaaaaaaaaaaa1111",
    });
    expect(meta).not.toBeNull();
    const secret = meta as NonNullable<typeof meta>;
    expect((await store.vault.info(secret)).hint).toBe("ghp_…1111");

    // The same secret on another profile, with another value: its backup overwrites this one.
    const other = memoryPlatform();
    await new AppStore(other.platform, { baseDelayMs: 60_000 }).vault.restore(
      secret,
      "glpat-bbbbbbbbbbbbbbbb2222",
    );
    const text = await createBackup(other.platform, PASS, PASS, { workFactor: 4 });
    mine.platform.vault.pickFile = async () => ({ text, path: "backup.fdbackup" });

    const previewed = await store.backup.preview(PASS);
    expect(previewed.ok).toBe(true);
    if (!previewed.ok || !("preview" in previewed)) return;
    expect((await store.backup.restore(previewed.preview, "overwrite")).ok).toBe(true);

    expect((await store.vault.info(secret)).hint).toBe("glpat-…2222");
  });
});
