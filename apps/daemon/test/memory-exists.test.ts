import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exists } from "../src/memory/exists.ts";
import { tempDir } from "./helpers.ts";

describe("memory-exists: whether a path is there", () => {
  test("a file and a folder exist; a missing path and a broken link do not", async () => {
    const dir = tempDir("fd-exists-");
    writeFileSync(join(dir, "file.txt"), "x");
    mkdirSync(join(dir, "folder"));
    symlinkSync(join(dir, "nowhere"), join(dir, "broken"));
    expect({
      file: await exists(join(dir, "file.txt")),
      folder: await exists(join(dir, "folder")),
      missing: await exists(join(dir, "missing")),
      broken: await exists(join(dir, "broken")),
    }).toEqual({ file: true, folder: true, missing: false, broken: false });
  });
});
