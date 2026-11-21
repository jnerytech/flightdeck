import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { backupNow } from "../../src/maintenance/backup.ts";
import { tempDir } from "../support/helpers.ts";

const NOW = Date.parse("2026-10-30T12:00:00.000Z");

/** What `backupNow` said about `out`: its error (code and text), or null when it wrote. */
async function refusal(out: string, force?: boolean) {
  const db = new Database(":memory:");
  try {
    await backupNow(db, tempDir(), NOW, out, force);
    return null;
  } catch (error) {
    const { code, message } = error as { code?: string; message: string };
    return { code, message };
  } finally {
    db.close();
  }
}

const isDatabase = (path: string) => readFileSync(path).subarray(0, 15).toString() === "SQLite format 3";
const skipLinks = process.platform === "win32"; // a link needs a privilege there

/**
 * Issue #3809: `backup --out <path>` used to delete whatever was at the path. It now refuses anything it finds
 * there (`lstat`, so a link counts as itself), and `force` replaces a file or the link itself, never a directory.
 */
describe("backupNow with a target that already exists (#3809)", () => {
  test("a file at the target is refused, with a code and the path, and it is left as it was", async () => {
    const out = join(tempDir(), "thesis.docx");
    writeFileSync(out, "precious");
    const got = await refusal(out);
    expect({ code: got?.code, names: got?.message.includes(out), force: got?.message.includes("--force") }).toEqual({
      code: "target_exists",
      names: true,
      force: true,
    });
    expect(readFileSync(out, "utf8")).toBe("precious");
  });

  test("force replaces the file with a copy of the database", async () => {
    const out = join(tempDir(), "thesis.docx");
    writeFileSync(out, "precious");
    expect(await refusal(out, true)).toBeNull();
    expect(isDatabase(out)).toBe(true);
  });

  test("a target that does not exist is written without force", async () => {
    const out = join(tempDir(), "new", "copy.db");
    expect(await refusal(out)).toBeNull();
    expect(isDatabase(out)).toBe(true);
  });

  test("a directory is refused, even with force, and what is inside stays", async () => {
    const out = join(tempDir(), "folder");
    mkdirSync(out);
    writeFileSync(join(out, "keep.txt"), "kept");
    const plain = await refusal(out);
    const forced = await refusal(out, true);
    expect({ plain: plain?.code, forced: forced?.code, kept: readFileSync(join(out, "keep.txt"), "utf8") }).toEqual({
      plain: "target_exists",
      forced: "target_exists",
      kept: "kept",
    });
  });

  test.skipIf(skipLinks)("a link is refused as itself, and what it points to is not touched", async () => {
    const dir = tempDir();
    const real = join(dir, "real.txt");
    const out = join(dir, "link.db");
    writeFileSync(real, "precious");
    symlinkSync(real, out);
    const got = await refusal(out);
    expect({ code: got?.code, real: readFileSync(real, "utf8"), link: lstatSync(out).isSymbolicLink() }).toEqual({
      code: "target_exists",
      real: "precious",
      link: true,
    });
  });

  test.skipIf(skipLinks)("a dangling link is refused: the copy does not land where it points", async () => {
    const dir = tempDir();
    const away = join(dir, "away.db");
    const out = join(dir, "link.db");
    symlinkSync(away, out);
    const got = await refusal(out);
    expect({ code: got?.code, written: existsSync(away) }).toEqual({
      code: "target_exists",
      written: false,
    });
  });

  test.skipIf(skipLinks)("force replaces the link itself and never writes through it", async () => {
    const dir = tempDir();
    const real = join(dir, "real.txt");
    const out = join(dir, "link.db");
    writeFileSync(real, "precious");
    symlinkSync(real, out);
    expect(await refusal(out, true)).toBeNull();
    expect({ real: readFileSync(real, "utf8"), link: lstatSync(out).isSymbolicLink(), copy: isDatabase(out) }).toEqual({
      real: "precious",
      link: false,
      copy: true,
    });
  });

  test("the automatic name is not guarded: two backups in one second still succeed", async () => {
    const db = new Database(":memory:");
    const dir = join(tempDir(), "backups");
    await backupNow(db, dir, NOW);
    const again = await backupNow(db, dir, NOW).then(
      () => "written",
      (error) => String(error),
    );
    db.close();
    expect(again).toBe("written");
  });
});
