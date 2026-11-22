import { describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawnExec } from "../../src/kernel/exec.ts";
import { tempDir } from "../support/helpers.ts";

const posix = process.platform !== "win32";

describe("spawnExec", () => {
  test.skipIf(!posix)(
    "finds a program on a PATH that changed after the process started (the demo puts its fake ssh-keyscan there)",
    async () => {
      const dir = tempDir();
      const tool = join(dir, "fd-exec-probe");
      writeFileSync(tool, "#!/bin/sh\necho found-on-the-new-path\n");
      chmodSync(tool, 0o755);
      const before = process.env.PATH;
      process.env.PATH = [dir, before].filter(Boolean).join(delimiter);
      try {
        const got = await spawnExec(["fd-exec-probe"]).catch((error: Error) => ({
          code: -1,
          stdout: error.message,
        }));
        expect(got).toEqual({ code: 0, stdout: "found-on-the-new-path\n" });
      } finally {
        process.env.PATH = before;
      }
    },
  );
});
