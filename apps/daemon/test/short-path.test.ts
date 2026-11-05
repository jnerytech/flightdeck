import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import { shortPath } from "./short-path.ts";

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

/** A file at the end of a folder whose name has no 8.3 form of its own. */
function longFile(folder: string): string {
  const dir = join(realTempDir("fd-short-path-"), folder);
  mkdirSync(dir);
  const file = join(dir, "flightdeckd.exe");
  writeFileSync(file, "");
  return file;
}

describe.skipIf(process.platform !== "win32")(
  "short-path: the 8.3 form of a path, on Windows",
  () => {
    test("names of at most 8.3, the same file, with the quotes proven on spaces and parentheses", () => {
      for (const folder of [
        "executavel-com-nome-bem-longo",
        "pasta com espacos longa",
        "pasta (com) parenteses longa",
      ]) {
        const file = longFile(folder);
        const short = shortPath(file);
        expect(short).not.toBe(file);
        expect(basename(short)).toBe("FLIGHT~1.EXE");
        expect(
          short
            .split("\\")
            .slice(1)
            .every((part) => /^[^.]{1,8}(\.[^.]{1,3})?$/.test(part)),
        ).toBe(true);
        expect(realpathSync.native(short)).toBe(file);
      }
    });

    test("it starts cmd only, never PowerShell", () => {
      const file = longFile("executavel-com-nome-bem-longo");
      const spawned = spyOn(Bun, "spawnSync");
      spies.push(spawned);
      shortPath(file);
      const programs = spawned.mock.calls.map((call) => String((call[0] as string[])[0]));
      expect(programs).toEqual(["cmd.exe"]);
    });
  },
);
