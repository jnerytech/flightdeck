import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readRegular, readRegularSized } from "../src/read-regular.ts";
import { tempDir } from "./helpers.ts";

describe("read-regular: the bytes of a regular file, and how big the file is", () => {
  test("a file larger than the limit gives the first bytes and the real size", async () => {
    const dir = tempDir("fd-regular-");
    writeFileSync(join(dir, "f.txt"), "0123456789");
    const read = await readRegularSized(join(dir, "f.txt"), 4);
    expect(read?.data.toString("utf8")).toBe("0123");
    expect(read?.size).toBe(10);
  });

  test("a file under the limit is read whole and its size is its length", async () => {
    const dir = tempDir("fd-regular-");
    writeFileSync(join(dir, "f.txt"), "abc");
    const read = await readRegularSized(join(dir, "f.txt"), 100);
    expect(read?.data.toString("utf8")).toBe("abc");
    expect(read?.size).toBe(3);
  });

  test("a missing path, a folder and a link are nothing, and readRegular keeps giving only the bytes", async () => {
    const dir = tempDir("fd-regular-");
    mkdirSync(join(dir, "d"));
    writeFileSync(join(dir, "real.txt"), "x");
    symlinkSync(join(dir, "real.txt"), join(dir, "link.txt"));
    for (const name of ["nada.txt", "d", "link.txt"]) {
      expect(await readRegularSized(join(dir, name), 10)).toBeNull();
      expect(await readRegular(join(dir, name), 10)).toBeNull();
    }
    expect((await readRegular(join(dir, "real.txt"), 10))?.toString("utf8")).toBe("x");
  });
});
