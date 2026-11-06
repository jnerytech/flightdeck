import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { statKind } from "../src/permissions/path-kind.ts";
import { tempDir } from "./helpers.ts";

describe("rule-path-kind: what a path a rule names is on disk (issue #395)", () => {
  test("a folder, a file, and a path that is not there or cannot be under a file", async () => {
    const dir = tempDir();
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "notes.txt"), "");
    expect(await statKind(join(dir, "src"))).toBe("dir");
    expect(await statKind(join(dir, "notes.txt"))).toBe("file");
    expect(await statKind(join(dir, "gone"))).toBe("missing");
    expect(await statKind(join(dir, "notes.txt", "x"))).toBe("missing");
  });

  test("a path it cannot look up counts as a folder, the reading that refuses", async () => {
    expect(await statKind("bad\0path")).toBe("dir");
  });
});
