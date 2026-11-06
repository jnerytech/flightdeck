import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { bareTempUses, TEMP_PATH_ALLOWED, tempPathCounts } from "../lib/temp-path-ratchet.ts";

const root = resolve(import.meta.dir, "../..");

describe("temp-path-ratchet: a test builds its folders in the real-path form (issue #262)", () => {
  test("a bare tmpdir() is a use, however it is imported", () => {
    expect(bareTempUses('const dir = mkdtempSync(join(tmpdir(), "fd-x-"));')).toBe(1);
    expect(bareTempUses("const base = os.tmpdir();")).toBe(1);
    expect(bareTempUses("a(tmpdir()); b(tmpdir());")).toBe(2);
  });

  test("the JS realpathSync is a use, realpathSync.native is not", () => {
    expect(bareTempUses("const base = realpathSync(tempDir('x'));")).toBe(1);
    expect(bareTempUses("const base = realpathSync.native(tempDir('x'));")).toBe(0);
    expect(bareTempUses('import { realpathSync } from "node:fs";')).toBe(0);
  });

  test("realTempDir, comments and words that only look alike are not uses", () => {
    expect(bareTempUses('const dir = realTempDir("fd-x-");')).toBe(0);
    expect(bareTempUses("// a fixed folder under tmpdir() outlives the run")).toBe(0);
    expect(bareTempUses("/* tmpdir() is the short form */ const x = 1;")).toBe(0);
    expect(bareTempUses("const tempDirOf = mytmpdir();")).toBe(0);
    expect(bareTempUses("expect(tmpdirName).toBe('x')")).toBe(0);
  });

  test("only the files that build the real-path form may name the OS temp folder", () => {
    expect(TEMP_PATH_ALLOWED).toEqual([
      "scripts/test/temp-dir.ts",
      "scripts/test/temp-run.ts",
      "scripts/test/temp-run-fixture.ts",
    ]);
  });

  test("no test of the repository uses a bare tmpdir() or the JS realpathSync", () => {
    expect(tempPathCounts(root)).toEqual({});
  });
});
