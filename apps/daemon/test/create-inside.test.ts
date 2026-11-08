import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInside } from "../src/create-inside.ts";
import { tempDir } from "./helpers.ts";

/** #75, #78: the harness apply and a card's spec template create files in a project this way. */
const posix = process.platform !== "win32";

function folders() {
  const base = realpathSync.native(tempDir("fd-create-"));
  const root = join(base, "tree");
  const outside = join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  return { root, outside };
}

describe("create-inside: a new file inside the folder, never through a link nor over a file", () => {
  test("it makes the folders on the way and writes the file", async () => {
    const { root } = folders();
    const made = await createInside(root, "docs/specs/a.md", "# A\n");
    expect([made, readFileSync(join(root, "docs/specs/a.md"), "utf8")]).toEqual([true, "# A\n"]);
  });

  test("a file already there is left as it is", async () => {
    const { root } = folders();
    writeFileSync(join(root, "a.md"), "mine\n");
    const made = await createInside(root, "a.md", "theirs\n");
    expect([made, readFileSync(join(root, "a.md"), "utf8")]).toEqual([false, "mine\n"]);
  });

  test.skipIf(!posix)("a link on the way, or at the file, leads nowhere outside", async () => {
    const { root, outside } = folders();
    symlinkSync(outside, join(root, "docs"));
    writeFileSync(join(outside, "target.md"), "outside\n");
    symlinkSync(join(outside, "target.md"), join(root, "b.md"));
    const throughFolder = await createInside(root, "docs/a.md", "x");
    const throughFile = await createInside(root, "b.md", "x");
    expect([
      throughFolder,
      existsSync(join(outside, "a.md")),
      throughFile,
      readFileSync(join(outside, "target.md"), "utf8"),
    ]).toEqual([false, false, false, "outside\n"]);
  });
});
